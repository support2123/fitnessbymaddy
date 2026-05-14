const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getClient } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000 calories', 'under 800',
  'clenbuterol', 'dnp', 'steroid', 'anabolic',
  'lose 10kg in 1 week', 'crash diet', 'starvation',
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getClient();

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

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand. You create weekly workout and nutrition plans that are:
- Science-backed and progressive
- Tailored to the client's current fitness level, goals, and feedback
- Safe and sustainable (no extreme calorie deficits, no banned substances)
- Structured as JSON for easy rendering

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "focus": "string describing this week's training focus",
    "days": [
      {
        "day": "Monday",
        "name": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "20 min LISS post-workout"
      }
    ],
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "daily_calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fat_g": 73,
    "meal_timing": ["7am Breakfast", "12pm Lunch", "4pm Snack", "7pm Dinner"],
    "notes": "Focus on protein timing around workouts"
  },
  "coach_notes": "Brief personalized note for the client"
}`;

    const clientContext = buildClientContext(client, intakeForm, recentCheckins, week_no);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: clientContext }],
    });

    const responseText = message.content[0].text;

    if (hasSafetyIssue(responseText)) {
      const { notifyMaddy } = require('../lib/whatsapp');
      await notifyMaddy(
        'Program safety flag',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek ${week_no}\nFlagged content in generated program. Manual review required.`
      );
      return res.status(200).json({ flagged: true, reason: 'Safety review needed' });
    }

    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: publicUrl } = db.storage.from('clients').getPublicUrl(pdfPath);

    await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: publicUrl?.publicUrl || pdfPath,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_notes,
    });

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      programData.coach_notes || 'Your new program is ready!',
    ]);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({
      success: true,
      program_id: client_id,
      week_no,
      pdf_url: publicUrl?.publicUrl || pdfPath,
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildClientContext(client, intake, checkins, weekNo) {
  let context = `Generate Week ${weekNo} program for:\n`;
  context += `Name: ${client.name || 'Client'}\n`;
  context += `Program: ${client.program}\n`;

  if (intake) {
    context += `Age: ${intake.age || 'N/A'}\n`;
    context += `Gender: ${intake.gender || 'N/A'}\n`;
    context += `Goal: ${intake.goal || 'General fitness'}\n`;
    context += `Injuries: ${intake.injuries || 'None reported'}\n`;
    context += `Diet preference: ${intake.diet_preference || 'No restriction'}\n`;
    context += `Experience: ${intake.experience_level || 'Intermediate'}\n`;
    context += `Current weight: ${intake.current_weight || 'N/A'}\n`;
    context += `Target weight: ${intake.target_weight || 'N/A'}\n`;
  }

  if (checkins && checkins.length > 0) {
    context += '\nRecent check-ins:\n';
    checkins.forEach(c => {
      context += `- Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, `;
      context += `Waist ${c.waist || 'N/A'}cm, `;
      context += `Compliance ${c.compliance_score}/10, `;
      context += `Energy ${c.energy}/10`;
      if (c.issues) context += `, Issues: ${c.issues}`;
      if (c.next_week_focus) context += `, Focus: ${c.next_week_focus}`;
      context += '\n';
    });
  }

  if (weekNo > 1) {
    context += `\nThis is Week ${weekNo} — progressively increase intensity from last week. `;
    context += 'Adjust based on compliance and energy scores.';
  } else {
    context += '\nThis is Week 1 — start with a manageable baseline to establish habits.';
  }

  return context;
}

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');

    doc
      .font('Helvetica-Bold')
      .fontSize(32)
      .fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 50, { align: 'center' });

    doc
      .fontSize(14)
      .fillColor('#D4AF7A')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 95, { align: 'center' });

    doc
      .fontSize(12)
      .fillColor('#ffffff')
      .text(`Client: ${client.name || 'Client'}`, 50, 130, { align: 'center' });

    doc.moveTo(50, 160).lineTo(545, 160).strokeColor('#B8965A').lineWidth(1).stroke();

    let y = 180;

    if (programData.workout_plan) {
      doc.font('Helvetica-Bold').fontSize(18).fillColor('#B8965A').text('WORKOUT PLAN', 50, y);
      y += 30;

      if (programData.workout_plan.focus) {
        doc.font('Helvetica').fontSize(10).fillColor('#D4AF7A')
          .text(programData.workout_plan.focus, 50, y);
        y += 20;
      }

      const days = programData.workout_plan.days || [];
      for (const day of days) {
        if (y > 700) {
          doc.addPage();
          doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
          y = 50;
        }

        doc.font('Helvetica-Bold').fontSize(13).fillColor('#B8965A')
          .text(`${day.day} — ${day.name}`, 50, y);
        y += 20;

        for (const ex of (day.exercises || [])) {
          doc.font('Helvetica').fontSize(10).fillColor('#ffffff')
            .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`, 50, y);
          y += 15;
          if (ex.notes) {
            doc.font('Helvetica-Oblique').fontSize(9).fillColor('#888888')
              .text(`    ${ex.notes}`, 50, y);
            y += 14;
          }
        }

        if (day.cardio) {
          doc.font('Helvetica-Oblique').fontSize(9).fillColor('#D4AF7A')
            .text(`  Cardio: ${day.cardio}`, 50, y);
          y += 14;
        }
        y += 10;
      }
    }

    if (y > 600) {
      doc.addPage();
      doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
      y = 50;
    }

    if (programData.nutrition_plan) {
      y += 10;
      doc.font('Helvetica-Bold').fontSize(18).fillColor('#B8965A').text('NUTRITION PLAN', 50, y);
      y += 30;

      const np = programData.nutrition_plan;
      doc.font('Helvetica').fontSize(11).fillColor('#ffffff');
      doc.text(`Daily Calories: ${np.daily_calories || 'TBD'} kcal`, 50, y); y += 18;
      doc.text(`Protein: ${np.protein_g || 'TBD'}g  |  Carbs: ${np.carbs_g || 'TBD'}g  |  Fat: ${np.fat_g || 'TBD'}g`, 50, y); y += 24;

      if (np.meal_timing) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#D4AF7A').text('Meal Timing:', 50, y);
        y += 18;
        for (const meal of np.meal_timing) {
          doc.font('Helvetica').fontSize(10).fillColor('#ffffff').text(`  ${meal}`, 50, y);
          y += 15;
        }
        y += 10;
      }

      if (np.notes) {
        doc.font('Helvetica-Oblique').fontSize(10).fillColor('#D4AF7A').text(np.notes, 50, y);
        y += 20;
      }
    }

    if (programData.coach_notes) {
      if (y > 680) {
        doc.addPage();
        doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
        y = 50;
      }
      y += 10;
      doc.moveTo(50, y).lineTo(545, y).strokeColor('#B8965A').lineWidth(0.5).stroke();
      y += 15;
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#B8965A').text('COACH NOTES', 50, y);
      y += 20;
      doc.font('Helvetica').fontSize(10).fillColor('#ffffff').text(programData.coach_notes, 50, y, { width: 495 });
    }

    doc.end();
  });
}
