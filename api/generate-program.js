const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'under 800',
  'clenbuterol', 'dnp', 'steroid', 'sarm', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

async function generateWithClaude(clientData, checkins) {
  const client = new Anthropic();

  const lastCheckin = checkins[0] || {};
  const prevCheckin = checkins[1] || {};

  const prompt = `You are a NASM-certified program architect for FitnessByMaddy, an elite online coaching brand.

Generate a 1-week training + nutrition plan for this client:

CLIENT PROFILE:
- Program: ${clientData.program}
- Current week: ${clientData.weekNo}
- Name: ${clientData.name || 'Client'}

LATEST CHECK-IN:
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues reported: ${lastCheckin.issues || 'None'}

PREVIOUS CHECK-IN:
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10

RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend any banned substances or supplements without evidence
- Be specific: sets, reps, rest periods, exact food quantities
- Adapt based on compliance and energy trends
- If compliance is low, simplify the plan
- If energy is low, reduce volume slightly

Return a JSON object with:
{
  "workout_plan": { "days": [...], "notes": "..." },
  "nutrition_plan": { "calories": ..., "protein_g": ..., "meals": [...], "notes": "..." },
  "coach_note": "A 1-2 sentence motivational + tactical note for the client"
}

Return ONLY valid JSON, no markdown.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text;
  return JSON.parse(text);
}

async function buildPDF(plan, clientName, weekNo) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#1a1a1a');
    doc.fillColor('#B8965A')
      .fontSize(28)
      .font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fillColor('#ffffff')
      .fontSize(14)
      .font('Helvetica')
      .text(`Week ${weekNo} Program — ${clientName || 'Client'}`, 50, 75, { align: 'center' });

    doc.moveDown(3);

    doc.fillColor('#B8965A').fontSize(18).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.fillColor('#2C2C2C').fontSize(11).font('Helvetica');

    const workout = plan.workout_plan;
    if (workout && workout.days) {
      workout.days.forEach((day, i) => {
        doc.moveDown(0.3);
        doc.fillColor('#1a1a1a').fontSize(13).font('Helvetica-Bold')
          .text(day.name || `Day ${i + 1}`);
        doc.fillColor('#2C2C2C').fontSize(10).font('Helvetica');

        if (day.exercises) {
          day.exercises.forEach(ex => {
            const line = typeof ex === 'string'
              ? ex
              : `${ex.name || ex.exercise} — ${ex.sets || ''}x${ex.reps || ''} ${ex.rest ? '(rest ' + ex.rest + ')' : ''}`;
            doc.text(`  → ${line}`, { indent: 10 });
          });
        }

        if (day.notes) {
          doc.fillColor('#6B6B6B').text(`  Note: ${day.notes}`, { indent: 10 });
        }
      });
    }

    if (workout && workout.notes) {
      doc.moveDown(0.5);
      doc.fillColor('#6B6B6B').fontSize(10).text(`Notes: ${workout.notes}`);
    }

    doc.moveDown(1.5);
    doc.fillColor('#B8965A').fontSize(18).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);

    const nutrition = plan.nutrition_plan;
    if (nutrition) {
      doc.fillColor('#2C2C2C').fontSize(11).font('Helvetica');
      if (nutrition.calories) doc.text(`Daily Calories: ${nutrition.calories} kcal`);
      if (nutrition.protein_g) doc.text(`Protein Target: ${nutrition.protein_g}g`);
      doc.moveDown(0.3);

      if (nutrition.meals) {
        nutrition.meals.forEach((meal, i) => {
          const mealText = typeof meal === 'string'
            ? meal
            : `${meal.name || 'Meal ' + (i + 1)}: ${meal.description || meal.items || ''}`;
          doc.text(`  ${i + 1}. ${mealText}`, { indent: 10 });
        });
      }

      if (nutrition.notes) {
        doc.moveDown(0.3);
        doc.fillColor('#6B6B6B').fontSize(10).text(`Notes: ${nutrition.notes}`);
      }
    }

    if (plan.coach_note) {
      doc.moveDown(1.5);
      doc.fillColor('#B8965A').fontSize(12).font('Helvetica-Bold')
        .text('NOTE FROM COACH:');
      doc.fillColor('#2C2C2C').fontSize(11).font('Helvetica')
        .text(plan.coach_note);
    }

    const bottomY = doc.page.height - 40;
    doc.fillColor('#C8B89A').fontSize(8)
      .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, bottomY, { align: 'center' });

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

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

    const clientData = {
      ...client,
      weekNo: week_no
    };

    const plan = await generateWithClaude(clientData, checkins || []);

    const planText = JSON.stringify(plan);
    if (hasSafetyIssue(planText)) {
      const { escalate } = require('../lib/escalation');
      await escalate(
        client.phone,
        'Unsafe program content flagged',
        `Week ${week_no} program for ${maskPhone(client.phone)} contains safety flags. Manual review required.`
      );
      return res.status(200).json({ ok: false, reason: 'safety_flagged' });
    }

    const pdfBuffer = await buildPDF(plan, client.name, week_no);

    const pdfPath = `${client.folder_url || 'clients/' + client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('client-data')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: publicUrl } = db.storage
      .from('client-data')
      .getPublicUrl(pdfPath);

    await db.from('programs').upsert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: publicUrl?.publicUrl || pdfPath,
      workout_plan: plan.workout_plan,
      nutrition_plan: plan.nutrition_plan,
      notes: plan.coach_note,
      generated_at: new Date().toISOString()
    }, { onConflict: 'client_id,week_no' });

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      week_no.toString(),
      plan.coach_note || 'Your new program is ready!'
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', parseInt(week_no));

    console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);
    return res.status(200).json({ ok: true, week_no, pdf_url: publicUrl?.publicUrl });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
