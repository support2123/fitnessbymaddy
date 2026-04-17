const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getClient } = require('../lib/supabase');
const { sendTemplate, logMessage } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  try {
    const db = getClient();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await db
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .eq('week_no', week_no - 1)
      .single();

    const prompt = buildPrompt(client, intake, recentCheckins, prevProgram, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text;

    if (hasSafetyIssue(content)) {
      await db.from('escalations').insert({
        phone: client.phone,
        reason: 'Program generation flagged for safety review',
        context: `Week ${week_no}: Safety flag in generated content`,
      });
      return res.status(200).json({
        flagged: true,
        reason: 'Content flagged for Maddy review',
      });
    }

    let parsed;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : content);
    } catch {
      parsed = { workout_plan: { raw: content }, nutrition_plan: {} };
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const fileName = `week_${week_no}.pdf`;
    const storagePath = `${client.folder_url || 'clients/' + client_id}/${fileName}`;

    const { error: uploadErr } = await db.storage
      .from('programs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) console.error('PDF upload error:', uploadErr.message);

    const { data: publicUrl } = db.storage
      .from('programs')
      .getPublicUrl(storagePath);

    const pdfUrl = publicUrl?.publicUrl || storagePath;

    const { data: program, error } = await db.from('programs').upsert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan || parsed.workout || {},
      nutrition_plan: parsed.nutrition_plan || parsed.nutrition || {},
      notes: parsed.notes || parsed.coach_notes || null,
    }, {
      onConflict: 'client_id,week_no',
    }).select().single();

    if (error) throw error;

    const note = parsed.notes || parsed.coach_notes || `Week ${week_no} program ready!`;
    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      note.substring(0, 200),
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    await logMessage(client.phone, 'out', `[Week ${week_no} program sent]`, 'weekly_program');

    return res.status(200).json({ success: true, programId: program.id, pdfUrl });
  } catch (err) {
    console.error('generate-program error:', maskPhone(req.body?.client_id), err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

function buildPrompt(client, intake, checkins, prevProgram, weekNo) {
  const profile = intake ? `
CLIENT PROFILE:
- Name: ${intake.name || client.name || 'Client'}
- Age: ${intake.age || 'Unknown'}
- Gender: ${intake.gender || 'Unknown'}
- Height: ${intake.height_cm ? intake.height_cm + 'cm' : 'Unknown'}
- Current Weight: ${intake.current_weight ? intake.current_weight + 'kg' : 'Unknown'}
- Goal Weight: ${intake.goal_weight ? intake.goal_weight + 'kg' : 'Unknown'}
- Goal: ${intake.goal || 'General fitness'}
- Injuries: ${intake.injuries || 'None reported'}
- Medical: ${intake.medical_conditions || 'None reported'}
- Diet Preference: ${intake.diet_preference || 'No preference'}
- Meals/day: ${intake.meals_per_day || 3}
- Experience: ${intake.workout_experience || 'Beginner'}
- Available days: ${(intake.available_days || []).join(', ') || '5 days'}
- Setting: ${intake.gym_or_home || 'Gym'}
- Wake: ${intake.wake_time || '7am'} | Sleep: ${intake.sleep_time || '11pm'}
` : `
CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
`;

  const checkinData = checkins && checkins.length > 0
    ? checkins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')
    : 'No check-in data yet (first week)';

  const prevPlan = prevProgram
    ? `PREVIOUS WEEK PLAN:\n${JSON.stringify(prevProgram.workout_plan, null, 2).substring(0, 1500)}`
    : 'No previous plan (first week)';

  return `You are an expert fitness coach creating a WEEK ${weekNo} program for a client in the "12-Week Custom Training" program by Fitness by Maddy.

${profile}

RECENT CHECK-INS:
${checkinData}

${prevPlan}

INSTRUCTIONS:
1. Create a complete 5-6 day workout split appropriate for the client's experience level and goals
2. Create a nutrition plan with daily macros and 3-4 meal templates
3. Adjust based on check-in data (compliance, energy, any issues)
4. If it's week 1, start moderate. Increase intensity gradually.
5. NEVER recommend extreme calorie deficits (below 1200 for women, 1500 for men)
6. NEVER recommend any banned substances or supplements beyond standard protein/creatine/multivitamin
7. Include warm-up and cool-down guidance

OUTPUT FORMAT (respond ONLY with this JSON, no other text):
\`\`\`json
{
  "workout_plan": {
    "split": "Push/Pull/Legs" or similar,
    "days": [
      {
        "day": "Day 1 - Push",
        "exercises": [
          {"name": "Barbell Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": ""}
        ],
        "warmup": "5 min incline walk + arm circles",
        "cooldown": "Chest/shoulder stretch 5 min"
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      {"meal": "Breakfast", "time": "8:00 AM", "items": ["4 egg whites + 1 whole egg", "2 toast", "1 banana"], "macros": "P:30g C:45g F:10g"}
    ],
    "supplements": ["Whey protein post-workout", "Creatine 5g daily"],
    "hydration": "3-4 litres water daily"
  },
  "notes": "One-liner context note for the client about this week's focus",
  "coach_notes": "Internal note about progression strategy"
}
\`\`\``;
}

function hasSafetyIssue(content) {
  const lower = content.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

async function generatePDF(client, plan, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(28).text('FITNESS BY MADDY', 50, 35);
    doc.fill('#FFFFFF').fontSize(14).text(
      `WEEK ${weekNo} PROGRAM — ${(client.name || 'Client').toUpperCase()}`,
      50, 75
    );

    doc.fill('#2C2C2C');
    let y = 140;

    if (plan.notes) {
      y += 10;
      doc.fill('#B8965A').fontSize(10).text(plan.notes, 50, y, { width: 500 });
      y += 30;
    }

    doc.fill('#2C2C2C').fontSize(18).text('WORKOUT PLAN', 50, y);
    y += 25;

    if (plan.workout_plan?.split) {
      doc.fontSize(11).text(`Split: ${plan.workout_plan.split}`, 50, y);
      y += 18;
    }

    const days = plan.workout_plan?.days || [];
    for (const day of days) {
      if (y > 700) { doc.addPage(); y = 50; }

      doc.fill('#B8965A').fontSize(13).text(day.day, 50, y);
      y += 18;

      if (day.warmup) {
        doc.fill('#6B6B6B').fontSize(9).text(`Warm-up: ${day.warmup}`, 60, y);
        y += 14;
      }

      for (const ex of (day.exercises || [])) {
        if (y > 720) { doc.addPage(); y = 50; }
        doc.fill('#2C2C2C').fontSize(10)
          .text(`• ${ex.name}`, 60, y)
          .text(`${ex.sets}×${ex.reps}  |  Rest: ${ex.rest || '60s'}`, 300, y);
        y += 15;
        if (ex.notes) {
          doc.fill('#6B6B6B').fontSize(8).text(ex.notes, 70, y);
          y += 12;
        }
      }

      if (day.cooldown) {
        doc.fill('#6B6B6B').fontSize(9).text(`Cool-down: ${day.cooldown}`, 60, y);
        y += 14;
      }
      y += 10;
    }

    if (y > 600) { doc.addPage(); y = 50; }
    doc.fill('#2C2C2C').fontSize(18).text('NUTRITION PLAN', 50, y);
    y += 25;

    const np = plan.nutrition_plan || {};
    if (np.calories) {
      doc.fontSize(11).text(
        `Daily Target: ${np.calories} kcal  |  P: ${np.protein_g}g  |  C: ${np.carbs_g}g  |  F: ${np.fat_g}g`,
        50, y
      );
      y += 22;
    }

    for (const meal of (np.meals || [])) {
      if (y > 700) { doc.addPage(); y = 50; }
      doc.fill('#B8965A').fontSize(11).text(`${meal.meal} (${meal.time || ''})`, 50, y);
      y += 16;
      for (const item of (meal.items || [])) {
        doc.fill('#2C2C2C').fontSize(10).text(`• ${item}`, 60, y);
        y += 14;
      }
      if (meal.macros) {
        doc.fill('#6B6B6B').fontSize(9).text(meal.macros, 60, y);
        y += 14;
      }
      y += 6;
    }

    if (np.supplements?.length) {
      y += 8;
      doc.fill('#2C2C2C').fontSize(11).text('Supplements:', 50, y);
      y += 16;
      for (const s of np.supplements) {
        doc.fill('#6B6B6B').fontSize(10).text(`• ${s}`, 60, y);
        y += 14;
      }
    }

    if (np.hydration) {
      y += 10;
      doc.fill('#6B6B6B').fontSize(10).text(`Hydration: ${np.hydration}`, 50, y);
    }

    const pageCount = doc.bufferedPageRange().count;
    doc.fill('#C8B89A').fontSize(8).text(
      'www.fitnessbymaddy.com | @fitnessbymaddy_',
      50, 780, { width: 500, align: 'center' }
    );

    doc.end();
  });
}
