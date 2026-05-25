const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000 cal', 'under 800', 'starvation',
  'clenbuterol', 'dnp', 'sarm', 'steroid', 'anabolic',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

function checkSafety(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.filter(f => lower.includes(f));
}

async function generatePDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 100).fill('#2C2C2C');
    doc.fontSize(28).fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 30, { align: 'center' });
    doc.fontSize(12).fillColor('#FFFFFF')
      .text(`Week ${weekNo} Program - ${client.name}`, 50, 65, { align: 'center' });

    doc.moveDown(3);
    doc.fillColor('#2C2C2C');

    doc.fontSize(18).text('WORKOUT PLAN', 50, 130);
    doc.moveTo(50, 152).lineTo(545, 152).strokeColor('#B8965A').stroke();
    doc.moveDown(0.5);

    if (workout && workout.days) {
      for (const day of workout.days) {
        doc.fontSize(13).fillColor('#B8965A').text(day.name || day.day, { continued: false });
        doc.fontSize(10).fillColor('#2C2C2C');
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.text(`  ${ex.name} - ${ex.sets}x${ex.reps} ${ex.notes || ''}`, { indent: 20 });
          }
        }
        doc.moveDown(0.5);
      }
    } else {
      doc.fontSize(10).text(JSON.stringify(workout, null, 2));
    }

    doc.addPage();

    doc.rect(0, 0, doc.page.width, 60).fill('#2C2C2C');
    doc.fontSize(18).fillColor('#B8965A')
      .text('NUTRITION PLAN', 50, 20, { align: 'center' });

    doc.moveDown(2);
    doc.fillColor('#2C2C2C');

    if (nutrition && nutrition.daily_targets) {
      doc.fontSize(12).text('Daily Targets:', 50, 80);
      doc.fontSize(10);
      const t = nutrition.daily_targets;
      doc.text(`  Calories: ${t.calories || 'TBD'} kcal`, { indent: 20 });
      doc.text(`  Protein: ${t.protein || 'TBD'}g`, { indent: 20 });
      doc.text(`  Carbs: ${t.carbs || 'TBD'}g`, { indent: 20 });
      doc.text(`  Fats: ${t.fats || 'TBD'}g`, { indent: 20 });
      doc.moveDown();
    }

    if (nutrition && nutrition.meals) {
      doc.fontSize(12).text('Meal Plan:');
      doc.fontSize(10);
      for (const meal of nutrition.meals) {
        doc.fillColor('#B8965A').text(meal.name || meal.time, { indent: 10 });
        doc.fillColor('#2C2C2C');
        if (meal.items) {
          for (const item of meal.items) {
            doc.text(`  - ${item}`, { indent: 20 });
          }
        }
        doc.moveDown(0.3);
      }
    }

    if (notes) {
      doc.moveDown();
      doc.fontSize(12).fillColor('#B8965A').text('Coach Notes:');
      doc.fontSize(10).fillColor('#2C2C2C').text(notes);
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor('#6B6B6B')
      .text('This program is personalized for you by Fitness by Maddy. Do not share or redistribute.', { align: 'center' });

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    const { data: lead } = client.lead_id
      ? await db.from('leads').select('intake_data').eq('id', client.lead_id).single()
      : { data: null };

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic();

    const systemPrompt = `You are a certified personal trainer and nutrition coach creating weekly programs for Fitness by Maddy clients. You create safe, evidence-based programs. Output valid JSON only.

Rules:
- Never prescribe calories below 1200 for women or 1500 for men
- Never recommend any banned substances, SARMs, or steroids
- Never promise specific weight loss timelines
- All exercises must have proper form cues
- Nutrition must account for dietary preferences and restrictions
- Progressive overload each week based on check-in data`;

    const userPrompt = `Create Week ${week_no} program for this client:

Client: ${client.name}
Program: ${client.program}
${lead?.intake_data ? `Intake Data: ${JSON.stringify(lead.intake_data)}` : ''}

${recentCheckins?.length ? `Recent Check-ins:\n${JSON.stringify(recentCheckins, null, 2)}` : 'No previous check-ins (Week 1)'}

Return JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1",
        "name": "Upper Body Push",
        "exercises": [
          { "name": "Exercise Name", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "form cue" }
        ]
      }
    ],
    "cardio": { "type": "...", "duration": "...", "frequency": "..." }
  },
  "nutrition_plan": {
    "daily_targets": { "calories": 2000, "protein": 150, "carbs": 200, "fats": 70 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "time": "8:00 AM", "items": ["item1", "item2"] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "Brief coach note for the client about this week's focus"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Claude response');

    const program = JSON.parse(jsonMatch[0]);

    const safetyIssues = checkSafety(responseText);
    if (safetyIssues.length > 0) {
      const { notifyMaddy } = require('./_lib/whatsapp');
      await notifyMaddy(
        'Program Safety Flag',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek ${week_no}\nFlags: ${safetyIssues.join(', ')}\nProgram NOT sent — needs manual review.`
      );

      await db.from('programs').insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        workout_plan: program.workout_plan,
        nutrition_plan: program.nutrition_plan,
        notes: `FLAGGED: ${safetyIssues.join(', ')} — ${program.notes || ''}`
      });

      return res.status(200).json({ ok: true, flagged: true, issues: safetyIssues });
    }

    const pdfBuffer = await generatePDF(
      client, week_no,
      program.workout_plan,
      program.nutrition_plan,
      program.notes
    );

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage.from('client-files').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: pdfUrl } = db.storage.from('client-files').getPublicUrl(pdfPath);

    const { error: progError } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl?.publicUrl || pdfPath,
      workout_plan: program.workout_plan,
      nutrition_plan: program.nutrition_plan,
      notes: program.notes || ''
    });

    if (progError) throw progError;

    const contextNote = program.notes || `Here's your Week ${week_no} program!`;
    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      body: `${contextNote}\n\nYour Week ${week_no} program PDF is ready: ${pdfUrl?.publicUrl || 'Check your client portal'}`,
      params: [client.name, String(week_no)]
    });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, week_no, pdf_url: pdfUrl?.publicUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
