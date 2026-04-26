const { supabase } = require('../lib/supabase');
const { sendMediaMessage, notifyMaddy } = require('../lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'anabolic', 'steroid',
  'lose 10kg in a week', 'lose 20 pounds in a week',
  'water fast', 'zero calorie'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  try {
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lead } = client.lead_id
      ? await supabase.from('leads').select('first_msg').eq('id', client.lead_id).single()
      : { data: null };

    const intakeData = lead?.first_msg ? tryParseJSON(lead.first_msg) : {};

    const programPlan = await generateWithClaude(client, recentCheckins || [], intakeData, week_no);

    if (!programPlan) {
      await notifyMaddy('Program gen failed', `Client: ${client.name}, Week: ${week_no}`);
      return res.status(500).json({ error: 'Generation failed' });
    }

    const planText = JSON.stringify(programPlan);
    if (SAFETY_FLAGS.some(flag => planText.toLowerCase().includes(flag))) {
      await notifyMaddy(
        'Safety flag — program halted',
        `Client: ${client.name}\nWeek: ${week_no}\nFlagged content detected. Manual review required.`
      );
      return res.json({ action: 'flagged_for_review', client_id, week_no });
    }

    const pdfBuffer = await generatePDF(client, programPlan, week_no);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
      return res.status(500).json({ error: 'Upload failed' });
    }

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    const { error: insertErr } = await supabase.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programPlan.workout,
      nutrition_plan: programPlan.nutrition,
      notes: programPlan.notes || null
    });

    if (insertErr) {
      console.error('Program insert error:', insertErr.message);
    }

    const caption = programPlan.notes
      ? `Week ${week_no} program ready! ${programPlan.notes}`
      : `Your Week ${week_no} program is here! Let's crush it 💪`;

    await sendMediaMessage(client.phone, pdfUrl, caption);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.json({ ok: true, client_id, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function generateWithClaude(client, checkins, intakeData, weekNo) {
  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  const prompt = `You are Maddy's program architect — an expert fitness coach creating weekly customised training and nutrition plans.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Week: ${weekNo} of 12
- Started: ${client.program_started_at}
${intakeData.goal ? `- Goal: ${intakeData.goal}` : ''}
${intakeData.injuries ? `- Injuries/limitations: ${intakeData.injuries}` : ''}
${intakeData.diet_preference ? `- Diet: ${intakeData.diet_preference}` : ''}
${intakeData.workout_days ? `- Available days: ${intakeData.workout_days}` : ''}
${intakeData.equipment_access ? `- Equipment: ${intakeData.equipment_access}` : ''}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

RULES:
- Progressive overload: increase volume/intensity vs prior week
- If compliance < 7, simplify the plan slightly
- If energy < 5, reduce volume by 10-15% and add recovery notes
- If client reported issues, adapt around them
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend supplements beyond protein, creatine, multivitamin
- Keep nutrition practical and culturally appropriate

Return ONLY valid JSON in this exact format:
{
  "workout": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          {"name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": ""}
        ]
      }
    ],
    "cardio": "...",
    "rest_days": "..."
  },
  "nutrition": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [
      {"meal": "Breakfast", "options": ["...", "..."]},
      {"meal": "Lunch", "options": ["...", "..."]},
      {"meal": "Dinner", "options": ["...", "..."]},
      {"meal": "Snacks", "options": ["...", "..."]}
    ],
    "hydration": "...",
    "supplements": ["..."]
  },
  "notes": "One-liner context note for WhatsApp message"
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0]?.text || '';
  return tryParseJSON(text);
}

async function generatePDF(client, plan, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 80).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill('#FFFFFF').text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    doc.moveDown(3);
    doc.fill('#2C2C2C');

    // Client info
    doc.fontSize(11).fill('#6B6B6B')
      .text(`Client: ${client.name || 'Client'}  |  Program: ${client.program}  |  Week ${weekNo}`, 50);
    doc.moveDown(1.5);

    // Workout section
    doc.fontSize(18).fill('#B8965A').text('WORKOUT PLAN', 50);
    doc.moveDown(0.3);
    doc.rect(50, doc.y, 200, 2).fill('#B8965A');
    doc.moveDown(0.8);

    if (plan.workout?.days) {
      for (const day of plan.workout.days) {
        if (doc.y > 700) doc.addPage();
        doc.fontSize(13).fill('#2C2C2C').text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#6B6B6B')
              .text(`  •  ${ex.name}  —  ${ex.sets}×${ex.reps}  (Rest: ${ex.rest})`, 60);
            if (ex.notes) doc.fontSize(9).fill('#999').text(`     ${ex.notes}`, 70);
          }
        }
        doc.moveDown(0.6);
      }
    }

    if (plan.workout?.cardio) {
      doc.fontSize(10).fill('#6B6B6B').text(`Cardio: ${plan.workout.cardio}`, 50);
    }
    if (plan.workout?.rest_days) {
      doc.fontSize(10).fill('#6B6B6B').text(`Rest Days: ${plan.workout.rest_days}`, 50);
    }

    doc.moveDown(1.5);
    if (doc.y > 650) doc.addPage();

    // Nutrition section
    doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50);
    doc.moveDown(0.3);
    doc.rect(50, doc.y, 200, 2).fill('#B8965A');
    doc.moveDown(0.8);

    if (plan.nutrition) {
      const n = plan.nutrition;
      doc.fontSize(11).fill('#2C2C2C')
        .text(`Daily Targets:  ${n.calories} kcal  |  P: ${n.protein_g}g  |  C: ${n.carbs_g}g  |  F: ${n.fat_g}g`, 50);
      doc.moveDown(0.6);

      if (n.meals) {
        for (const meal of n.meals) {
          doc.fontSize(12).fill('#2C2C2C').text(meal.meal, 50);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill('#6B6B6B').text(`  •  ${opt}`, 60);
            }
          }
          doc.moveDown(0.4);
        }
      }

      if (n.hydration) {
        doc.moveDown(0.3);
        doc.fontSize(10).fill('#6B6B6B').text(`Hydration: ${n.hydration}`, 50);
      }
      if (n.supplements?.length) {
        doc.fontSize(10).fill('#6B6B6B').text(`Supplements: ${n.supplements.join(', ')}`, 50);
      }
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill('#C8B89A')
        .text('fitnessbymaddy.com  •  Confidential — prepared exclusively for ' + (client.name || 'client'),
          50, 780, { align: 'center', width: 495 });
    }

    doc.end();
  });
}

function tryParseJSON(str) {
  try {
    const match = str.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}
