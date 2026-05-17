const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate, maskPhone } = require('./lib/whatsapp');
const { logMessage } = require('./lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const supabase = getSupabase();

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

    const { data: intakeJson } = await supabase.storage
      .from('intake-forms')
      .download(`${client.lead_id || client_id}.json`);

    let intakeData = {};
    if (intakeJson) {
      try {
        const text = await intakeJson.text();
        intakeData = JSON.parse(text);
      } catch (e) {}
    }

    const programData = await generateWithClaude(client, recentCheckins || [], intakeData, week_no);

    if (programData.flagged) {
      const { sendTemplate: notify } = require('./lib/whatsapp');
      await notify('+917082478374', 'escalation_alert', [
        'Program flagged for review',
        maskPhone(client.phone),
      ]);
      return res.status(200).json({ flagged: true, reason: programData.flagReason });
    }

    const pdfBuffer = await generatePDF(client, programData, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await supabase.storage
      .from('programs')
      .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    const { data: pdfUrl } = supabase.storage
      .from('programs')
      .getPublicUrl(pdfPath);

    const { error } = await supabase.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl.publicUrl,
      workout_plan: programData.workout,
      nutrition_plan: programData.nutrition,
      notes: programData.notes,
    });

    if (error) throw error;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      programData.notes || 'Keep pushing!',
    ]);
    await logMessage(client.phone, 'out', null, 'weekly_program');

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: pdfUrl.publicUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function generateWithClaude(client, checkins, intakeData, weekNo) {
  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const clientContext = {
    name: client.name,
    program: client.program,
    weekNo,
    goal: intakeData.goal || 'general fitness',
    injuries: intakeData.injuries || 'none reported',
    dietPreference: intakeData.diet_preference || 'no preference',
    trainingExperience: intakeData.training_experience || 'intermediate',
    schedule: intakeData.schedule || '5 days/week',
    recentCheckins: checkins.map(c => ({
      week: c.week_no,
      weight: c.weight,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues,
    })),
  };

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: `You are a certified fitness program architect for FitnessByMaddy. Generate a weekly training and nutrition plan.

CLIENT DATA:
${JSON.stringify(clientContext, null, 2)}

RULES:
- Never prescribe extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned substances or unregulated supplements
- Never set unrealistic timelines (max 1kg/week fat loss)
- Adjust based on recent check-in compliance and energy
- If client reports pain/injury, HALT and flag for review

OUTPUT FORMAT (JSON):
{
  "workout": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "notes": "..."}] }
    ],
    "restDays": ["Saturday", "Sunday"],
    "cardio": "..."
  },
  "nutrition": {
    "calories": 2000,
    "protein": 150,
    "carbs": 200,
    "fats": 70,
    "mealPlan": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."]
  },
  "notes": "One-liner motivation/context for this week",
  "flagged": false,
  "flagReason": null
}

Return ONLY valid JSON.`
    }],
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse Claude response');

  const parsed = JSON.parse(jsonMatch[0]);

  if (parsed.nutrition?.calories < 1200) {
    return { flagged: true, flagReason: 'Calories below safe minimum' };
  }

  return parsed;
}

async function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, 595, 80).fill('#2C2C2C');
    doc.fontSize(24).fill('#B8965A').text('FITNESS BY MADDY', 50, 28);
    doc.fontSize(10).fill('#FFFFFF').text(`Week ${weekNo} Program`, 400, 35);

    doc.moveDown(3);
    doc.fontSize(12).fill('#2C2C2C')
      .text(`Client: ${client.name || 'Client'}`, 50);
    doc.text(`Program: ${client.program}`)
      .text(`Week: ${weekNo}`);

    doc.moveDown(2);
    doc.fontSize(16).fill('#B8965A').text('WORKOUT PLAN');
    doc.moveDown(0.5);

    if (programData.workout?.days) {
      for (const day of programData.workout.days) {
        doc.fontSize(12).fill('#2C2C2C').text(`${day.day} — ${day.focus}`);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#6B6B6B')
              .text(`  • ${ex.name}: ${ex.sets}×${ex.reps}${ex.notes ? ' (' + ex.notes + ')' : ''}`, { indent: 20 });
          }
        }
        doc.moveDown(0.5);
      }
    }

    doc.moveDown(1);
    doc.fontSize(16).fill('#B8965A').text('NUTRITION PLAN');
    doc.moveDown(0.5);

    if (programData.nutrition) {
      const n = programData.nutrition;
      doc.fontSize(11).fill('#2C2C2C')
        .text(`Daily Targets: ${n.calories} kcal | P: ${n.protein}g | C: ${n.carbs}g | F: ${n.fats}g`);
      doc.moveDown(0.5);

      if (n.mealPlan) {
        for (const meal of n.mealPlan) {
          doc.fontSize(11).fill('#2C2C2C').text(meal.meal + ':');
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill('#6B6B6B').text(`  • ${opt}`, { indent: 20 });
            }
          }
          doc.moveDown(0.3);
        }
      }
    }

    if (programData.notes) {
      doc.moveDown(1);
      doc.fontSize(10).fill('#6B6B6B')
        .text(`Coach's Note: ${programData.notes}`);
    }

    doc.end();
  });
}
