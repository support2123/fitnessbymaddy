const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendMedia } = require('../lib/whatsapp');
const { logMessage } = require('../lib/messages');
const { maskPhone } = require('../lib/utils');

const MADDY_PHONE = '917082478374';

const RISKY_TERMS = [
  'very low calorie', 'vlcd', 'under 800', 'under 1000',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in a week', 'extreme fasting', 'water fast',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    const { data: intake } = await db
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .limit(1)
      .single();

    const systemPrompt = `You are a NASM-certified fitness coach program architect for FitnessByMaddy.
Generate a weekly workout and nutrition plan. Output valid JSON only.
Structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }
      ]}
    ],
    "cardio": "...",
    "rest_days": "..."
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meals": [
      { "meal": "Breakfast", "options": ["...", "..."] }
    ],
    "supplements": "...",
    "hydration": "..."
  },
  "coach_notes": "..."
}

Rules:
- Never recommend below 1200 kcal for women or 1500 for men
- Never suggest banned substances, steroids, SARMs, or extreme protocols
- Adjust based on compliance and energy scores from check-ins
- Account for injuries and medical conditions from intake
- Progressive overload each week`;

    const userPrompt = `Client: ${client.name}
Program: ${client.program} — Week ${week_no}
${intake ? `Age: ${intake.age}, Gender: ${intake.gender}, Goal: ${intake.goal}
Injuries: ${intake.injuries || 'None'}, Diet: ${intake.diet_pref || 'No preference'}
Medical: ${intake.medical_conditions || 'None'}, Weight: ${intake.current_weight || '?'}kg` : ''}
${checkins && checkins.length > 0 ? `\nRecent check-ins:\n${checkins.map((c) =>
  `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
).join('\n')}` : 'No prior check-ins — this is week 1.'}`;

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;

    const risky = RISKY_TERMS.some((t) => rawText.toLowerCase().includes(t));
    if (risky) {
      await db.from('programs').insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        notes: 'FLAGGED — contains risky content, awaiting Maddy review',
        workout_plan: {},
        nutrition_plan: {},
      });
      await sendMedia(MADDY_PHONE, '', '');
      const msg = `⚠️ Program for ${client.name} (${maskPhone(client.phone)}) Week ${week_no} FLAGGED for review — contains potentially risky recommendations.`;
      const { sendText } = require('../lib/whatsapp');
      await sendText(MADDY_PHONE, msg);
      await logMessage(MADDY_PHONE, 'out', msg, 'program_flagged');
      return res.status(200).json({ flagged: true });
    }

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError.message);
    }

    const { data: urlData } = db.storage
      .from('programs')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || '';

    await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_notes || '',
    });

    if (pdfUrl) {
      const caption = `Week ${week_no} program ready! 💪 ${programData.coach_notes || ''}`.slice(0, 500);
      await sendMedia(client.phone, pdfUrl, caption);
      await logMessage(client.phone, 'out', caption, 'program_delivery');

      await db.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('client_id', client_id)
        .eq('week_no', week_no);
    }

    return res.status(200).json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generatePDF(client, weekNo, data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fillColor('#FFFFFF')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75, { align: 'center' });
    doc.fontSize(10).fillColor('#D4AF7A')
      .text(`${client.name} — ${client.program}`, 50, 95, { align: 'center' });

    doc.moveDown(3);

    // Workout Plan
    doc.fontSize(18).fillColor('#2C2C2C').text('WORKOUT PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(0.5);

    if (data.workout_plan && data.workout_plan.days) {
      for (const day of data.workout_plan.days) {
        if (doc.y > 700) doc.addPage();
        doc.fontSize(13).fillColor('#B8965A').text(day.day.toUpperCase(), 50);
        doc.fontSize(10).fillColor('#6B6B6B').text(`Focus: ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (doc.y > 720) doc.addPage();
            doc.fontSize(10).fillColor('#2C2C2C')
              .text(`  • ${ex.name} — ${ex.sets}×${ex.reps} | Rest: ${ex.rest}`, 60);
            if (ex.notes) {
              doc.fontSize(8).fillColor('#6B6B6B').text(`    ${ex.notes}`, 70);
            }
          }
        }
        doc.moveDown(0.5);
      }
    }

    if (data.workout_plan?.cardio) {
      doc.fontSize(10).fillColor('#2C2C2C').text(`Cardio: ${data.workout_plan.cardio}`, 50);
    }

    // Nutrition Plan
    doc.addPage();
    doc.fontSize(18).fillColor('#2C2C2C').text('NUTRITION PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(0.5);

    if (data.nutrition_plan) {
      const np = data.nutrition_plan;
      doc.fontSize(12).fillColor('#2C2C2C')
        .text(`Daily Targets: ${np.calories} kcal | P: ${np.protein_g}g | C: ${np.carbs_g}g | F: ${np.fats_g}g`, 50);
      doc.moveDown(0.5);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fontSize(11).fillColor('#B8965A').text(meal.meal, 50);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fillColor('#6B6B6B').text(`  • ${opt}`, 60);
            }
          }
          doc.moveDown(0.3);
        }
      }

      if (np.supplements) {
        doc.moveDown(0.5);
        doc.fontSize(11).fillColor('#2C2C2C').text(`Supplements: ${np.supplements}`, 50);
      }
      if (np.hydration) {
        doc.fontSize(11).fillColor('#2C2C2C').text(`Hydration: ${np.hydration}`, 50);
      }
    }

    // Coach Notes
    if (data.coach_notes) {
      doc.moveDown(1);
      doc.fontSize(12).fillColor('#B8965A').text('COACH NOTES', 50);
      doc.fontSize(10).fillColor('#6B6B6B').text(data.coach_notes, 50);
    }

    // Footer
    doc.fontSize(8).fillColor('#C8B89A')
      .text('© Fitness by Maddy — fitnessbymaddy.com', 50, 770, { align: 'center' });

    doc.end();
  });
}
