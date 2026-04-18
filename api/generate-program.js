const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'sarm', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await supabase
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Generate safe, evidence-based, individualized weekly workout and nutrition plans.

RULES:
- Never prescribe fewer than 1200 calories for women or 1500 for men
- Never recommend banned substances, steroids, SARMs, or dangerous supplements
- Never promise specific weight loss timelines (e.g., "lose 10kg in 2 weeks")
- Account for any injuries or medical conditions mentioned
- Use progressive overload principles
- Adjust based on compliance scores and energy levels from check-ins
- Output valid JSON only`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
${JSON.stringify({
  name: client.name,
  program: client.program,
  started: client.program_started_at,
  intake: intake ? {
    age: intake.age, gender: intake.gender,
    height: intake.height_cm, weight: intake.weight_kg,
    goal: intake.goal, injuries: intake.injuries,
    medical: intake.medical_conditions,
    diet: intake.diet_preference,
    experience: intake.training_experience,
    days: intake.available_days,
    equipment: intake.equipment_access,
  } : 'No intake form submitted',
}, null, 2)}

RECENT CHECK-INS:
${JSON.stringify(recentCheckins || [], null, 2)}

Return JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }
      ]}
    ],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "weekly_note": "A short motivational/instructional note for the client"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in Claude response');

    const program = JSON.parse(jsonMatch[0]);

    const contentLower = content.toLowerCase();
    const safetyIssue = SAFETY_FLAGS.find(flag => contentLower.includes(flag));
    if (safetyIssue) {
      const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
      await sendTemplate(maddyPhone, 'escalation_alert', [
        client.name || 'Client',
        `Program W${week_no} flagged for safety: "${safetyIssue}"`,
        'Auto-send halted. Please review in admin.',
      ]);

      await supabase.from('programs').insert({
        client_id, week_no,
        workout_plan: program.workout_plan,
        nutrition_plan: program.nutrition_plan,
        notes: `FLAGGED: ${safetyIssue} — awaiting Maddy review`,
      });

      return res.status(200).json({ action: 'flagged', reason: safetyIssue });
    }

    const pdfBuffer = await generatePDF(client, week_no, program);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData.publicUrl;

    const { error: dbError } = await supabase.from('programs').upsert({
      client_id, week_no,
      workout_plan: program.workout_plan,
      nutrition_plan: program.nutrition_plan,
      pdf_url: pdfUrl,
      notes: program.weekly_note || null,
    }, { onConflict: 'client_id,week_no' });

    if (dbError) throw dbError;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `${week_no}`,
      program.weekly_note || 'Your new program is ready!',
    ], pdfUrl);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

function generatePDF(client, weekNo, program) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill('#FFFFFF')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 75);
    doc.fontSize(10).fill('#D4AF7A')
      .text(`${client.program?.toUpperCase() || 'CUSTOM'} PROGRAM`, 50, 95);

    doc.moveDown(3);

    doc.fontSize(18).fill('#B8965A').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#E8E3DC');
    doc.moveDown(0.5);

    if (program.workout_plan?.days) {
      for (const day of program.workout_plan.days) {
        if (doc.y > 680) { doc.addPage(); }
        doc.fontSize(13).fill('#2C2C2C').text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#6B6B6B')
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`, 60);
            if (ex.notes) {
              doc.fontSize(9).fill('#999').text(`    ${ex.notes}`, 70);
            }
          }
        }
        doc.moveDown(0.5);
      }
    }

    if (program.workout_plan?.cardio) {
      doc.moveDown(0.5);
      doc.fontSize(11).fill('#2C2C2C').text('Cardio:', 50);
      const c = program.workout_plan.cardio;
      doc.fontSize(10).fill('#6B6B6B')
        .text(`  ${c.type} — ${c.frequency}, ${c.duration}`, 60);
    }

    doc.addPage();

    doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#E8E3DC');
    doc.moveDown(0.5);

    if (program.nutrition_plan) {
      const np = program.nutrition_plan;
      doc.fontSize(12).fill('#2C2C2C')
        .text(`Daily Targets: ${np.calories} kcal  |  P: ${np.protein_g}g  |  C: ${np.carbs_g}g  |  F: ${np.fat_g}g`, 50);
      doc.moveDown(0.5);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fontSize(11).fill('#2C2C2C').text(meal.meal, 50);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill('#6B6B6B').text(`  • ${opt}`, 60);
            }
          }
          doc.moveDown(0.3);
        }
      }

      if (np.supplements?.length) {
        doc.moveDown(0.5);
        doc.fontSize(11).fill('#2C2C2C').text('Supplements:', 50);
        for (const sup of np.supplements) {
          doc.fontSize(10).fill('#6B6B6B').text(`  • ${sup}`, 60);
        }
      }

      if (np.hydration) {
        doc.moveDown(0.5);
        doc.fontSize(11).fill('#2C2C2C').text('Hydration:', 50);
        doc.fontSize(10).fill('#6B6B6B').text(`  ${np.hydration}`, 60);
      }
    }

    if (program.weekly_note) {
      doc.moveDown(1);
      doc.rect(50, doc.y, 495, 60).fill('#FAF8F4');
      doc.fontSize(10).fill('#B8965A').text('NOTE FROM MADDY', 60, doc.y - 50);
      doc.fontSize(10).fill('#6B6B6B').text(program.weekly_note, 60, doc.y - 30, { width: 475 });
    }

    doc.end();
  });
}
