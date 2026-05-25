const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'crash diet', 'laxative'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

async function generatePlanWithClaude(clientData, checkins) {
  const client = new Anthropic();

  const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand. You create weekly workout and nutrition plans that are:
- Evidence-based and safe
- Progressive (building on previous weeks)
- Personalised to the client's data, goals, and feedback
- Practical and sustainable

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {"day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..."}]},
      ...
    ],
    "cardio": "...",
    "rest_days": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      {"meal": "Breakfast", "options": ["...", "..."]},
      ...
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "weekly_note": "A 2-3 sentence personalised note for the client about their focus this week."
}

NEVER recommend: extreme calorie restriction (<1200 for women, <1500 for men), banned substances, unrealistic timelines, or anything medically risky.`;

  const lastTwo = checkins.slice(-2);
  const userPrompt = `Generate Week ${clientData.week_no} program for this client:

CLIENT PROFILE:
- Name: ${clientData.name}
- Program: ${clientData.program}
- Started: ${clientData.program_started_at}

RECENT CHECK-INS:
${lastTwo.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n')}

${lastTwo.length === 0 ? 'This is the first week - create a foundation program.' : 'Adjust based on their progress and feedback.'}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });

  const text = response.content[0].text;

  if (hasSafetyIssue(text)) {
    throw new Error('SAFETY_FLAG: Generated plan contains risky content');
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No valid JSON in Claude response');

  return JSON.parse(jsonMatch[0]);
}

function generatePDF(plan, clientName, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fill('#FFFFFF').text(`WEEK ${weekNo} PROGRAM`, 50, 75, { align: 'center' });
    doc.fontSize(10).fill('#999999').text(`Prepared for ${clientName}`, 50, 95, { align: 'center' });

    let y = 140;

    if (plan.weekly_note) {
      doc.fontSize(11).fill('#B8965A').text(plan.weekly_note, 50, y, { width: 500 });
      y += 40;
    }

    doc.fontSize(18).fill('#2C2C2C').text('WORKOUT PLAN', 50, y);
    y += 30;

    if (plan.workout_plan?.days) {
      for (const day of plan.workout_plan.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.fontSize(13).fill('#B8965A').text(day.day.toUpperCase() + ' — ' + (day.focus || ''), 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 740) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill('#2C2C2C')
              .text(`  ${ex.name}`, 60, y)
              .text(`${ex.sets}x${ex.reps} | Rest: ${ex.rest || '60s'}`, 300, y);
            y += 16;
            if (ex.notes) {
              doc.fontSize(8).fill('#6B6B6B').text(`    ${ex.notes}`, 70, y);
              y += 12;
            }
          }
        }
        y += 10;
      }
    }

    if (plan.workout_plan?.cardio) {
      if (y > 700) { doc.addPage(); y = 50; }
      doc.fontSize(10).fill('#6B6B6B').text(`Cardio: ${plan.workout_plan.cardio}`, 50, y);
      y += 20;
    }

    if (y > 600) { doc.addPage(); y = 50; }
    doc.fontSize(18).fill('#2C2C2C').text('NUTRITION PLAN', 50, y);
    y += 30;

    if (plan.nutrition_plan) {
      const np = plan.nutrition_plan;
      doc.fontSize(11).fill('#2C2C2C')
        .text(`Daily Targets: ${np.calories} cal | ${np.protein_g}g protein | ${np.carbs_g}g carbs | ${np.fat_g}g fat`, 50, y);
      y += 25;

      if (np.meals) {
        for (const meal of np.meals) {
          if (y > 740) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill('#B8965A').text(meal.meal, 50, y);
          y += 16;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(9).fill('#6B6B6B').text(`  • ${opt}`, 60, y);
              y += 14;
            }
          }
          y += 6;
        }
      }

      if (np.hydration) {
        if (y > 740) { doc.addPage(); y = 50; }
        doc.fontSize(10).fill('#6B6B6B').text(`Hydration: ${np.hydration}`, 50, y);
        y += 20;
      }
    }

    doc.rect(0, doc.page.height - 40, doc.page.width, 40).fill('#2C2C2C');
    doc.fontSize(8).fill('#B8965A')
      .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, doc.page.height - 28, { align: 'center', width: 500 });

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const plan = await generatePlanWithClaude(
      { ...client, week_no },
      checkins || []
    );

    const pdfBuffer = await generatePDF(plan, client.name, week_no);

    const fileName = `week_${week_no}.pdf`;
    const filePath = `clients/${client_id}/${fileName}`;

    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('Upload error:', uploadError.message);
    }

    const { data: publicUrl } = db.storage
      .from('programs')
      .getPublicUrl(filePath);

    const pdfUrl = publicUrl?.publicUrl || filePath;

    await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: plan.workout_plan,
      nutrition_plan: plan.nutrition_plan,
      notes: plan.weekly_note
    });

    await sendTemplate(client.phone, 'weekly_program', [
      client.name,
      `Week ${week_no}`,
      plan.weekly_note || 'Your new program is ready!',
      pdfUrl
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    if (err.message?.startsWith('SAFETY_FLAG')) {
      const { escalate } = require('./lib/escalate');
      await escalate('system', 'unsafe_program_generated', err.message);
      return res.status(422).json({ error: 'Plan flagged for review', flagged: true });
    }

    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
