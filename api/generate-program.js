const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { programLabel, cors } = require('./_lib/helpers');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800',
  'steroid', 'sarm', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'crash diet', 'starvation',
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

async function generatePlan(client, checkins) {
  const anthropic = new Anthropic();

  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  const prompt = `You are a world-class certified fitness coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${programLabel(client.program)}
- Started: ${client.program_started_at}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins (Week 1)'}

INSTRUCTIONS:
1. Create a complete weekly workout plan (5-6 days, with rest days)
2. Create a nutrition plan with daily calorie target, macro split, and meal framework
3. Include a short motivational note

OUTPUT FORMAT (JSON only, no markdown):
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name":"...","sets":3,"reps":"8-12","notes":"..."}] }
    ],
    "rest_days": ["Sunday"],
    "notes": "..."
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "suggestion": "...", "calories": 500 }
    ],
    "notes": "..."
  },
  "motivation": "..."
}

SAFETY RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend any banned or controlled substances
- Keep weight loss expectations to 0.5-1kg per week max
- If client reports pain or injury, reduce load and note it`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}

function buildPDF(plan, client, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill('#FFFFFF')
      .text(`${programLabel(client.program)} | Week ${weekNo}`, 50, 75);
    doc.fontSize(10).fill('#999999')
      .text(`Prepared for ${client.name || 'Client'}`, 50, 95);

    doc.moveDown(4);

    const workout = plan.workout_plan;
    if (workout && workout.days) {
      doc.fontSize(18).fill('#2C2C2C').text('WORKOUT PLAN', 50);
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
      doc.moveDown(0.5);

      for (const day of workout.days) {
        if (doc.y > 700) doc.addPage();
        doc.fontSize(13).fill('#B8965A').text(day.day.toUpperCase(), 50);
        doc.fontSize(11).fill('#666666').text(day.focus || '', 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#2C2C2C')
              .text(`  ${ex.name}  -  ${ex.sets} x ${ex.reps}${ex.notes ? '  (' + ex.notes + ')' : ''}`, 60);
          }
        }
        doc.moveDown(0.5);
      }
    }

    if (doc.y > 600) doc.addPage();
    doc.moveDown(1);

    const nutrition = plan.nutrition_plan;
    if (nutrition) {
      doc.fontSize(18).fill('#2C2C2C').text('NUTRITION PLAN', 50);
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
      doc.moveDown(0.5);

      doc.fontSize(11).fill('#2C2C2C')
        .text(`Daily Target: ${nutrition.daily_calories} kcal | P: ${nutrition.protein_g}g | C: ${nutrition.carbs_g}g | F: ${nutrition.fat_g}g`, 50);
      doc.moveDown(0.5);

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          doc.fontSize(10).fill('#B8965A').text(meal.meal, 60);
          doc.fontSize(10).fill('#2C2C2C')
            .text(`  ${meal.suggestion} (~${meal.calories} kcal)`, 60);
          doc.moveDown(0.3);
        }
      }
    }

    if (plan.motivation) {
      if (doc.y > 680) doc.addPage();
      doc.moveDown(1);
      doc.fontSize(12).fill('#B8965A').text('NOTE FROM MADDY', 50);
      doc.moveDown(0.3);
      doc.fontSize(10).fill('#666666').text(plan.motivation, 50, doc.y, { width: 495 });
    }

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
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

    const planText = await generatePlan(client, checkins || []);

    if (hasSafetyIssue(planText)) {
      await sendWhatsApp({
        phone: process.env.MADDY_PHONE || '+917082478374',
        templateName: 'escalation_alert',
        params: [
          client.name || 'Unknown',
          `Week ${week_no} program flagged for safety review`,
        ],
      });
      return res.status(200).json({
        ok: false,
        reason: 'Program flagged for Maddy review due to safety concerns',
      });
    }

    let plan;
    try {
      const jsonMatch = planText.match(/\{[\s\S]*\}/);
      plan = JSON.parse(jsonMatch ? jsonMatch[0] : planText);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    const pdfBuffer = await buildPDF(plan, client, week_no);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: publicUrl } = db.storage
      .from('programs')
      .getPublicUrl(filePath);

    const pdfUrl = publicUrl?.publicUrl || filePath;

    await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      pdf_url: pdfUrl,
      workout_plan: plan.workout_plan || {},
      nutrition_plan: plan.nutrition_plan || {},
      notes: plan.motivation || '',
    });

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'program_delivery',
      params: [client.name || 'there', String(week_no)],
      body: `Your Week ${week_no} program is ready! ${plan.motivation || 'Let\'s crush it this week.'}\n\nDownload: ${pdfUrl}`,
    });

    await db
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
