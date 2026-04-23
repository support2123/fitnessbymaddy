const { getSupabase } = require('./lib/supabase');
const { sendTemplate, notifyMaddy } = require('./lib/whatsapp');
const { cors, parseBody, maskPhone, PROGRAM_NAMES } = require('./lib/helpers');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'less than 1000 calories', 'less than 800 calories',
  'clenbuterol', 'dnp', 'ephedrine', 'anabolic',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'extreme deficit'
];

function checkSafety(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

async function generateWithClaude(client, checkins) {
  const anthropic = new Anthropic();

  const lastTwo = checkins.slice(0, 2);
  const checkinSummary = lastTwo.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  const nextWeek = (lastTwo[0]?.week_no || 0) + 1;

  const prompt = `You are a certified fitness program architect for Fitness by Maddy. Generate a customized weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${PROGRAM_NAMES[client.program] || client.program}
- Age: ${client.age || 'N/A'}
- Goal: ${client.goal || 'General fitness'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No restrictions'}
- Schedule: ${client.schedule || 'Flexible'}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins (Week 1)'}

Generate a Week ${nextWeek} program as JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min incline walk + dynamic stretches",
        "cooldown": "5 min stretching"
      }
    ],
    "rest_days": ["Sunday"],
    "weekly_cardio": "3x 20min LISS or 2x 15min HIIT"
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1 description", "Option 2 description"] }
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3-4 liters water daily"
  },
  "notes": "Brief coaching note for the week"
}

RULES:
- Be specific with weights/progressions based on check-in data
- Never prescribe less than 1200 calories for women or 1500 for men
- No banned substances or extreme protocols
- Adjust based on compliance and energy scores
- If injuries reported, provide safe alternatives`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response');

  return { parsed: JSON.parse(jsonMatch[0]), raw: text };
}

async function generatePDF(client, weekNo, program) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 80).fill('#2C2C2C');
    doc.fontSize(24).fill('#B8965A').text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill('#FFFFFF').text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });
    doc.fontSize(10).text(client.name || 'Client', 400, 35, { align: 'right', width: 145 });

    doc.moveDown(3);
    let y = 110;

    // Workout Plan
    doc.fontSize(18).fill('#2C2C2C').text('WORKOUT PLAN', 50, y);
    y += 30;

    doc.rect(50, y, 495, 2).fill('#B8965A');
    y += 15;

    const workout = program.workout_plan;
    if (workout && workout.days) {
      for (const day of workout.days) {
        if (y > 720) { doc.addPage(); y = 50; }

        doc.fontSize(13).fill('#B8965A').text(day.day.toUpperCase(), 50, y);
        doc.fontSize(10).fill('#6B6B6B').text(day.focus || '', 200, y);
        y += 20;

        if (day.warmup) {
          doc.fontSize(9).fill('#6B6B6B').text(`Warmup: ${day.warmup}`, 60, y);
          y += 14;
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 740) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill('#2C2C2C').text(
              `${ex.name}  —  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`,
              70, y
            );
            y += 14;
            if (ex.notes) {
              doc.fontSize(8).fill('#6B6B6B').text(ex.notes, 80, y);
              y += 12;
            }
          }
        }
        y += 10;
      }
    }

    if (workout && workout.weekly_cardio) {
      if (y > 700) { doc.addPage(); y = 50; }
      doc.fontSize(10).fill('#2C2C2C').text(`Cardio: ${workout.weekly_cardio}`, 50, y);
      y += 25;
    }

    // Nutrition Plan
    if (y > 600) { doc.addPage(); y = 50; }

    doc.fontSize(18).fill('#2C2C2C').text('NUTRITION PLAN', 50, y);
    y += 30;
    doc.rect(50, y, 495, 2).fill('#B8965A');
    y += 15;

    const nutrition = program.nutrition_plan;
    if (nutrition) {
      doc.fontSize(11).fill('#2C2C2C')
        .text(`Calories: ${nutrition.calories} kcal  |  Protein: ${nutrition.protein_g}g  |  Carbs: ${nutrition.carbs_g}g  |  Fat: ${nutrition.fat_g}g`, 50, y);
      y += 25;

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill('#B8965A').text(meal.meal, 50, y);
          y += 16;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(9).fill('#6B6B6B').text(`• ${opt}`, 65, y);
              y += 13;
            }
          }
          y += 5;
        }
      }

      if (nutrition.supplements) {
        if (y > 720) { doc.addPage(); y = 50; }
        doc.fontSize(10).fill('#2C2C2C').text('Supplements:', 50, y);
        y += 14;
        for (const s of nutrition.supplements) {
          doc.fontSize(9).fill('#6B6B6B').text(`• ${s}`, 65, y);
          y += 13;
        }
        y += 5;
      }

      if (nutrition.hydration) {
        doc.fontSize(9).fill('#6B6B6B').text(`Hydration: ${nutrition.hydration}`, 50, y);
        y += 20;
      }
    }

    // Notes
    if (program.notes) {
      if (y > 700) { doc.addPage(); y = 50; }
      doc.rect(50, y, 495, 2).fill('#B8965A');
      y += 15;
      doc.fontSize(10).fill('#2C2C2C').text('Coach\'s Note:', 50, y);
      y += 16;
      doc.fontSize(10).fill('#6B6B6B').text(program.notes, 50, y, { width: 495 });
    }

    // Footer
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill('#C8B89A')
        .text('fitnessbymaddy.com', 50, 780)
        .text(`Page ${i + 1} of ${pages.count}`, 450, 780, { align: 'right', width: 95 });
    }

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const sb = getSupabase();

  try {
    const body = await parseBody(req);
    const { client_id, week_no } = body;

    if (!client_id) {
      return res.status(400).json({ error: 'Missing client_id' });
    }

    const weekNum = parseInt(week_no, 10) || 1;

    const { data: client } = await sb
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .maybeSingle();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: existing } = await sb
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', weekNum)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Program already generated for this week' });
    }

    const { data: checkins } = await sb
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { parsed: program, raw } = await generateWithClaude(client, checkins || []);

    if (checkSafety(raw)) {
      await notifyMaddy(
        'SAFETY FLAG — program halted',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek: ${weekNum}\nFlagged content in generated program. Review required.`
      );

      await sb.from('programs').insert({
        client_id,
        week_no: weekNum,
        workout_plan: program.workout_plan,
        nutrition_plan: program.nutrition_plan,
        notes: `[FLAGGED FOR REVIEW] ${program.notes || ''}`
      });

      return res.status(200).json({ success: false, flagged: true });
    }

    const pdfBuffer = await generatePDF(client, weekNum, program);

    const pdfPath = `${client_id}/week_${weekNum}.pdf`;
    const { error: uploadErr } = await sb.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: urlData } = sb.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || '';

    const { data: programRecord } = await sb
      .from('programs')
      .insert({
        client_id,
        week_no: weekNum,
        pdf_url: pdfUrl,
        workout_plan: program.workout_plan,
        nutrition_plan: program.nutrition_plan,
        notes: program.notes || ''
      })
      .select()
      .single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(weekNum),
      pdfUrl
    ]);

    await sb.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', programRecord.id);

    return res.status(200).json({
      success: true,
      program_id: programRecord.id,
      pdf_url: pdfUrl
    });

  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
