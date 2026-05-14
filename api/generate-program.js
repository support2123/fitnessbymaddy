const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { notifyMaddy } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'under 1000 calories', 'under 800 calories', 'extreme deficit',
  'dnp', 'clenbuterol', 'steroids', 'anabolic', 'sarm',
  'lose 10kg in 1 week', 'starvation', 'water fast for',
  'ephedrine', 'banned substance'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

async function generatePDF(workout, nutrition, clientName, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35, { align: 'left' });
    doc.fill('#FFFFFF').fontSize(14).font('Helvetica')
      .text(`Week ${weekNo} Program — ${clientName || 'Client'}`, 50, 75);
    doc.fill('#B8965A').fontSize(10)
      .text(`Generated ${new Date().toLocaleDateString('en-IN')}`, 50, 95);

    doc.moveDown(4);
    doc.fill('#2C2C2C').fontSize(20).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.fill('#B8965A').rect(50, doc.y, 200, 2).fill('#B8965A');
    doc.moveDown(1);

    if (workout && workout.days) {
      for (const day of workout.days) {
        doc.fill('#2C2C2C').fontSize(14).font('Helvetica-Bold')
          .text(day.name || 'Day', 50);
        doc.moveDown(0.3);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fill('#6B6B6B').fontSize(11).font('Helvetica')
              .text(`  ${ex.name} — ${ex.sets}x${ex.reps} ${ex.notes || ''}`, 60);
          }
        }
        doc.moveDown(0.8);
      }
    } else {
      doc.fill('#6B6B6B').fontSize(11).font('Helvetica')
        .text(JSON.stringify(workout, null, 2), 60);
    }

    if (doc.y > 650) doc.addPage();

    doc.moveDown(2);
    doc.fill('#2C2C2C').fontSize(20).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);
    doc.fill('#B8965A').rect(50, doc.y, 200, 2).fill('#B8965A');
    doc.moveDown(1);

    if (nutrition) {
      if (nutrition.calories) {
        doc.fill('#2C2C2C').fontSize(12).font('Helvetica-Bold')
          .text(`Daily Target: ${nutrition.calories} kcal`, 60);
        doc.moveDown(0.3);
      }
      if (nutrition.macros) {
        doc.fill('#6B6B6B').fontSize(11).font('Helvetica')
          .text(`Protein: ${nutrition.macros.protein}g | Carbs: ${nutrition.macros.carbs}g | Fat: ${nutrition.macros.fat}g`, 60);
        doc.moveDown(0.5);
      }
      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          doc.fill('#2C2C2C').fontSize(12).font('Helvetica-Bold')
            .text(meal.name || 'Meal', 60);
          doc.fill('#6B6B6B').fontSize(11).font('Helvetica')
            .text(meal.description || '', 70);
          doc.moveDown(0.5);
        }
      }
      if (nutrition.notes) {
        doc.moveDown(0.5);
        doc.fill('#6B6B6B').fontSize(10).font('Helvetica')
          .text(`Notes: ${nutrition.notes}`, 60);
      }
    }

    doc.moveDown(3);
    const bottomY = doc.page.height - 60;
    doc.fill('#B8965A').fontSize(9).font('Helvetica')
      .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, bottomY, { align: 'center' });

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const { client_id, week_no } = req.body || {};

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client } = await db.from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { data: recentCheckins } = await db.from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const intakeBucket = db.storage.from('intake-forms');
  let intakeData = null;
  try {
    const { data: intakeBlob } = await intakeBucket.download(
      `leads/${client.lead_id}/intake.json`
    );
    if (intakeBlob) {
      intakeData = JSON.parse(await intakeBlob.text());
    }
  } catch (e) {
    // No intake form available
  }

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  const systemPrompt = `You are a certified fitness coach AI assistant for FitnessByMaddy. Generate a weekly training and nutrition program in strict JSON format.

Output ONLY valid JSON with this structure:
{
  "workout": {
    "days": [
      {
        "name": "Day 1 — Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "notes": "2min rest" }
        ]
      }
    ]
  },
  "nutrition": {
    "calories": 2200,
    "macros": { "protein": 180, "carbs": 220, "fat": 65 },
    "meals": [
      { "name": "Meal 1 — Breakfast", "description": "4 egg whites, 2 whole eggs, oats with banana" }
    ],
    "notes": "Increase water to 3L on training days"
  },
  "coach_note": "Brief 1-liner for WhatsApp message"
}

Rules:
- Never recommend fewer than 1200 kcal/day for women or 1500 for men
- Never recommend banned substances, extreme fasting, or unrealistic timelines
- Adjust based on check-in data: if compliance is low, simplify; if energy is low, increase carbs
- Be specific with exercises, sets, reps, and rest periods
- Account for any injuries or medical conditions mentioned in the intake`;

  const userPrompt = `Client: ${client.name || 'Unknown'}
Program: ${client.program}
Week: ${week_no}
${intakeData ? `Intake: ${JSON.stringify(intakeData)}` : 'No intake data available.'}
Recent check-ins: ${recentCheckins?.length ? JSON.stringify(recentCheckins) : 'None yet (first week).'}

Generate Week ${week_no} program.`;

  let aiResponse;
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });
    aiResponse = msg.content[0].text;
  } catch (e) {
    console.error('Claude API error:', e.message);
    return res.status(502).json({ error: 'AI generation failed' });
  }

  if (hasSafetyIssue(aiResponse)) {
    await notifyMaddy(
      'Program flagged — safety concern in AI output',
      client.phone,
      `Week ${week_no}: AI output contained flagged content`
    );
    return res.status(200).json({ ok: false, reason: 'flagged_for_review' });
  }

  let parsed;
  try {
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : aiResponse);
  } catch (e) {
    console.error('JSON parse error from AI output');
    return res.status(500).json({ error: 'Failed to parse AI response' });
  }

  const pdfBuffer = await generatePDF(
    parsed.workout,
    parsed.nutrition,
    client.name,
    week_no
  );

  const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
  const bucket = db.storage.from('client-files');
  const { error: uploadErr } = await bucket.upload(pdfPath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true
  });

  if (uploadErr) {
    console.error('PDF upload error:', uploadErr);
    return res.status(500).json({ error: 'PDF upload failed' });
  }

  const { data: urlData } = bucket.getPublicUrl(pdfPath);
  const pdfUrl = urlData?.publicUrl || pdfPath;

  const { data: program, error: dbErr } = await db.from('programs').insert({
    client_id,
    week_no: parseInt(week_no),
    pdf_url: pdfUrl,
    workout_plan: parsed.workout || null,
    nutrition_plan: parsed.nutrition || null,
    notes: parsed.coach_note || null
  }).select().single();

  if (dbErr) {
    console.error('Program insert error:', dbErr);
    return res.status(500).json({ error: 'Failed to save program' });
  }

  await sendTemplate(client.phone, 'weekly_program', [
    client.name || 'there',
    String(week_no),
    parsed.coach_note || `Your Week ${week_no} program is ready!`,
    pdfUrl
  ]);

  await db.from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('id', program.id);

  return res.status(200).json({ ok: true, program_id: program.id, pdf_url: pdfUrl });
};
