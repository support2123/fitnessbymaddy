const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalation');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'banned substance', 'steroid',
  'dnp', 'clenbuterol', 'ephedrine', 'crash diet', 'water fast',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeForm } = await db
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .limit(1)
      .single();

    const anthropic = new Anthropic();

    const systemPrompt = `You are a NASM-certified fitness program architect for "Fitness by Maddy", an elite online coaching brand. You create safe, evidence-based, personalised weekly workout and nutrition plans.

RULES:
- Never recommend calories below 1200 for women or 1500 for men
- Never suggest banned or dangerous supplements
- Never promise unrealistic timelines (max 1kg/week fat loss)
- Base plans on the client's current stats, progress trends, and feedback
- Include progressive overload principles
- Always provide exercise alternatives for injuries

OUTPUT FORMAT: Return valid JSON only with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "...", "sets": 3, "reps": "10-12", "rest": "60s", "notes": "..." }
      ]}
    ],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 65,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "weekly_notes": "...",
  "next_week_focus": "..."
}`;

    const userPrompt = buildUserPrompt(client, intakeForm, recentCheckins, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse program JSON from Claude response');
    }

    const program = JSON.parse(jsonMatch[0]);

    const contentStr = JSON.stringify(program).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => contentStr.includes(flag));

    if (flagged) {
      await escalateToMaddy('Generated program flagged for safety review', {
        phone: maskPhone(client.phone),
        message: `Week ${week_no} program for ${client.name} flagged — needs manual review`,
      });
      return res.status(200).json({ ok: true, flagged: true, message: 'Program flagged for review' });
    }

    const pdfBuffer = await generatePDF(client, program, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage.from('client-files').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    const { data: urlData } = db.storage.from('client-files').getPublicUrl(pdfPath);

    const { error: insertError } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: urlData.publicUrl,
      workout_plan: program.workout_plan,
      nutrition_plan: program.nutrition_plan,
      notes: program.weekly_notes || null,
    });

    if (insertError) throw insertError;

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      program.weekly_notes || 'Your new program is ready!',
      urlData.publicUrl,
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ ok: true, pdf_url: urlData.publicUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

function buildUserPrompt(client, intake, checkins, weekNo) {
  let prompt = `Create Week ${weekNo} program for client:\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${client.program}\n`;

  if (intake) {
    prompt += `Age: ${intake.age || 'N/A'}, Gender: ${intake.gender || 'N/A'}\n`;
    prompt += `Height: ${intake.height || 'N/A'}, Starting Weight: ${intake.weight || 'N/A'}kg\n`;
    prompt += `Goal: ${intake.goal || 'General fitness'}\n`;
    prompt += `Injuries: ${intake.injuries || 'None reported'}\n`;
    prompt += `Diet Preference: ${intake.diet_preference || 'No preference'}\n`;
    prompt += `Workout Days: ${intake.workout_days || 5}/week\n`;
    prompt += `Gym Access: ${intake.gym_access ? 'Yes' : 'No'}\n`;
    prompt += `Experience: ${intake.experience_level || 'Intermediate'}\n`;
    prompt += `Medical: ${intake.medical_conditions || 'None'}\n`;
  }

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent Check-in Data:\n`;
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, `;
      prompt += `Compliance ${c.compliance_score}/10, Energy ${c.energy}/10\n`;
      if (c.issues) prompt += `  Issues: ${c.issues}\n`;
    }
  }

  if (weekNo > 1) {
    prompt += `\nThis is week ${weekNo} — apply progressive overload from previous weeks.`;
  }

  return prompt;
}

function generatePDF(client, program, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill('#FFFFFF').text(
      `Week ${weekNo} Program — ${client.name || 'Client'}`,
      50, 75
    );

    doc.fill('#2C2C2C');
    let y = 150;

    if (program.workout_plan && program.workout_plan.days) {
      doc.fontSize(18).fill('#B8965A').text('WORKOUT PLAN', 50, y);
      y += 30;

      for (const day of program.workout_plan.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.fontSize(13).fill('#2C2C2C').text(`${day.day} — ${day.focus}`, 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill('#6B6B6B').text(
              `  ${ex.name} — ${ex.sets} x ${ex.reps} | Rest: ${ex.rest || '60s'}`,
              70, y
            );
            y += 16;
          }
        }
        y += 10;
      }
    }

    if (program.nutrition_plan) {
      if (y > 600) { doc.addPage(); y = 50; }

      doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50, y);
      y += 30;

      const np = program.nutrition_plan;
      doc.fontSize(11).fill('#2C2C2C').text(
        `Calories: ${np.calories} | Protein: ${np.protein_g}g | Carbs: ${np.carbs_g}g | Fat: ${np.fat_g}g`,
        50, y
      );
      y += 25;

      if (np.meals) {
        for (const meal of np.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill('#2C2C2C').text(`${meal.meal}:`, 50, y);
          y += 16;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill('#6B6B6B').text(`  • ${opt}`, 70, y);
              y += 14;
            }
          }
          y += 6;
        }
      }
    }

    if (program.weekly_notes) {
      if (y > 680) { doc.addPage(); y = 50; }
      doc.fontSize(18).fill('#B8965A').text('NOTES', 50, y);
      y += 25;
      doc.fontSize(10).fill('#6B6B6B').text(program.weekly_notes, 50, y, { width: 500 });
    }

    doc.end();
  });
}
