const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { notifyMaddy } = require('../lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'sarm', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'crash diet', 'water fast'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  try {
    const { data: client } = await db.from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await db.from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentCheckins } = await db.from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Design safe, effective, progressive weekly programs based on client data.

Rules:
- Never prescribe below 1200 kcal/day for women or 1500 kcal/day for men
- Never recommend supplements beyond basic protein, creatine, multivitamin
- Always include warm-up and cool-down
- Progressive overload each week based on check-in data
- Account for injuries, limitations, and preferences
- Output must be valid JSON with "workout_plan" and "nutrition_plan" keys`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
Name: ${client.name}
Program: ${client.program}
Started: ${client.program_started_at}

${intake ? `INTAKE DATA:
Age: ${intake.age}, Gender: ${intake.gender}
Goal: ${intake.goal}
Injuries: ${intake.injuries || 'None'}
Medical: ${intake.medical_conditions || 'None'}
Diet preference: ${intake.diet_preference || 'No preference'}
Experience: ${intake.workout_experience || 'Beginner'}
Equipment: ${intake.available_equipment || 'Full gym'}
Schedule: ${intake.schedule || 'Flexible'}` : 'No intake form submitted yet.'}

${recentCheckins && recentCheckins.length > 0 ? `RECENT CHECK-INS:
${recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')}` : 'No previous check-ins.'}

Return a JSON object with exactly these keys:
{
  "workout_plan": {
    "overview": "brief week summary",
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }
      ], "warmup": "...", "cooldown": "..." }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meal_framework": [
      { "meal": "Breakfast", "suggestion": "...", "macros": "..." }
    ],
    "hydration": "...",
    "supplements": []
  },
  "coach_notes": "personalized note for the client"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;

    if (hasSafetyIssue(responseText)) {
      await notifyMaddy(
        'Program Safety Flag',
        `Client: ${client.name} (Week ${week_no})\nAuto-generation halted — review needed.\nContent flagged for potential safety concern.`
      );
      return res.status(200).json({ flagged: true, reason: 'safety_review_needed' });
    }

    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch (parseErr) {
      console.error('Failed to parse Claude response');
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage.from('client-files')
      .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadErr) throw uploadErr;

    const { data: urlData } = db.storage.from('client-files').getPublicUrl(pdfPath);

    const { data: program, error: insertErr } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      pdf_url: urlData.publicUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_notes || null
    }).select().single();

    if (insertErr) throw insertErr;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      programData.coach_notes || 'Your new program is ready!'
    ]);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id, pdf_url: urlData.publicUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const gold = '#B8965A';
    const charcoal = '#2C2C2C';

    doc.rect(0, 0, doc.page.width, 120).fill(charcoal);
    doc.fontSize(28).fill('#FFFFFF').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill(gold).text(`WEEK ${weekNo} PROGRAM`, 50, 72);
    doc.fontSize(10).fill('#999999').text(`${client.name} | ${client.program}`, 50, 95);

    doc.moveDown(3);

    const wp = programData.workout_plan;
    if (wp) {
      doc.fontSize(18).fill(charcoal).text('WORKOUT PLAN', 50);
      doc.moveDown(0.5);
      if (wp.overview) {
        doc.fontSize(10).fill('#666666').text(wp.overview, 50, undefined, { width: 500 });
        doc.moveDown(1);
      }

      if (wp.days) {
        for (const day of wp.days) {
          if (doc.y > 680) doc.addPage();

          doc.rect(50, doc.y, 500, 24).fill(gold);
          doc.fontSize(11).fill('#FFFFFF').text(`${day.day} — ${day.focus}`, 58, doc.y + 6);
          doc.moveDown(1.5);

          if (day.warmup) {
            doc.fontSize(9).fill('#888888').text(`Warm-up: ${day.warmup}`, 58);
            doc.moveDown(0.3);
          }

          if (day.exercises) {
            for (const ex of day.exercises) {
              if (doc.y > 720) doc.addPage();
              doc.fontSize(10).fill(charcoal)
                .text(`• ${ex.name}`, 58, undefined, { continued: true })
                .fill('#666666')
                .text(`  ${ex.sets} x ${ex.reps} | Rest: ${ex.rest}${ex.notes ? ' | ' + ex.notes : ''}`);
              doc.moveDown(0.3);
            }
          }

          if (day.cooldown) {
            doc.fontSize(9).fill('#888888').text(`Cool-down: ${day.cooldown}`, 58);
          }
          doc.moveDown(1);
        }
      }
    }

    if (doc.y > 500) doc.addPage();

    const np = programData.nutrition_plan;
    if (np) {
      doc.fontSize(18).fill(charcoal).text('NUTRITION PLAN', 50);
      doc.moveDown(0.5);

      doc.fontSize(10).fill('#666666')
        .text(`Daily Target: ${np.daily_calories} kcal | P: ${np.protein_g}g | C: ${np.carbs_g}g | F: ${np.fat_g}g`, 50);
      doc.moveDown(1);

      if (np.meal_framework) {
        for (const meal of np.meal_framework) {
          doc.fontSize(11).fill(gold).text(meal.meal, 50);
          doc.fontSize(10).fill(charcoal).text(meal.suggestion, 58);
          if (meal.macros) doc.fontSize(9).fill('#888888').text(meal.macros, 58);
          doc.moveDown(0.5);
        }
      }

      if (np.hydration) {
        doc.moveDown(0.5);
        doc.fontSize(10).fill(charcoal).text(`Hydration: ${np.hydration}`, 50);
      }
    }

    if (programData.coach_notes) {
      doc.moveDown(2);
      doc.rect(50, doc.y, 500, 1).fill(gold);
      doc.moveDown(0.5);
      doc.fontSize(12).fill(charcoal).text("COACH'S NOTE", 50);
      doc.moveDown(0.3);
      doc.fontSize(10).fill('#666666').text(programData.coach_notes, 50, undefined, { width: 500 });
    }

    doc.end();
  });
}
