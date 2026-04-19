const { supabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone, notifyMaddy } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'below 1000 cal', 'under 800 cal', 'extreme cut', 'starvation',
  'clenbuterol', 'dnp', 'steroid', 'sarm', 'hgh', 'testosterone injection',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

function hasSafetyViolation(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id) {
      return res.status(400).json({ error: 'client_id required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const targetWeek = week_no || 1;

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeMessages } = await supabase
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .like('body', '%intake_form%')
      .order('sent_at', { ascending: false })
      .limit(1);

    let intakeData = {};
    if (intakeMessages && intakeMessages.length > 0) {
      try {
        const match = intakeMessages[0].body.match(/\[intake_form\]\s*(.*)/);
        if (match) intakeData = JSON.parse(match[1]);
      } catch (e) {}
    }

    const clientProfile = {
      name: client.name,
      program: client.program,
      week: targetWeek,
      totalWeeks: client.program === '12wk' ? 12 : 6,
      age: intakeData.age,
      gender: intakeData.gender,
      goal: intakeData.goal,
      injuries: intakeData.injuries,
      dietPref: intakeData.diet_pref,
      schedule: intakeData.schedule,
      experience: intakeData.experience_level,
      recentCheckins: (recentCheckins || []).map(c => ({
        week: c.week_no,
        weight: c.weight,
        waist: c.waist,
        compliance: c.compliance_score,
        energy: c.energy,
        issues: c.issues
      }))
    };

    const anthropic = new Anthropic();

    const systemPrompt = `You are Maddy's program architect — an expert fitness coach designing weekly programs for FitnessByMaddy clients. You create safe, science-backed, personalized workout and nutrition plans.

RULES:
- Never recommend extreme calorie deficits (minimum 1200 cal for women, 1500 for men)
- Never recommend banned substances, steroids, or SARMs
- Never promise unrealistic timelines (max 1kg fat loss per week)
- Adjust intensity based on compliance and energy scores
- Account for injuries and medical conditions
- Be warm but professional in notes
- If the client has low compliance, simplify the program
- If energy is low, reduce volume and add recovery focus`;

    const userPrompt = `Create Week ${targetWeek} program for this client:

${JSON.stringify(clientProfile, null, 2)}

Return ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ], "warmup": "5 min incline walk", "cooldown": "5 min stretching" }
    ],
    "rest_days": ["Sunday"],
    "weekly_notes": ""
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"] }
    ],
    "supplements": [],
    "hydration": "3L minimum",
    "notes": ""
  },
  "coach_note": "One-liner motivational or tactical note for WhatsApp delivery"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;

    if (hasSafetyViolation(responseText)) {
      await notifyMaddy(
        'Program safety flag',
        `Week ${targetWeek} for ${client.name} (${maskPhone(client.phone)}) flagged for review. Auto-send halted.`
      );

      await supabase.from('programs').insert({
        client_id,
        week_no: targetWeek,
        notes: 'FLAGGED FOR REVIEW — safety violation detected',
        workout_plan: {},
        nutrition_plan: {}
      });

      return res.status(200).json({
        ok: false,
        action: 'flagged_for_review',
        reason: 'Safety violation detected in generated program'
      });
    }

    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse generated program' });
    }

    const pdfBuffer = await generatePDF(client, targetWeek, parsed);

    const pdfPath = `clients/${client_id}/week_${targetWeek}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: publicUrl } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);

    await supabase.from('programs').insert({
      client_id,
      week_no: targetWeek,
      pdf_url: publicUrl?.publicUrl || pdfPath,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.coach_note || ''
    });

    const coachNote = parsed.coach_note || `Week ${targetWeek} program is ready! 💪`;

    await sendWhatsApp(client.phone, 'weekly_program', {
      name: client.name,
      templateParams: [client.name, String(targetWeek)]
    }, `${coachNote}\n\nYour Week ${targetWeek} program has been uploaded. Check your dashboard or download the PDF.`);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', targetWeek);

    return res.status(200).json({
      ok: true,
      action: 'program_generated',
      week: targetWeek,
      pdf_url: publicUrl?.publicUrl || pdfPath
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};

async function generatePDF(client, weekNo, plan) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35);
    doc.fill('#FFFFFF').fontSize(14).font('Helvetica')
      .text(`Week ${weekNo} Program`, 50, 72);
    doc.fill('#C8B89A').fontSize(11)
      .text(`${client.name} | ${client.program.toUpperCase()}`, 50, 92);

    doc.moveDown(3);

    doc.fill('#2C2C2C').fontSize(20).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, 150);
    doc.moveTo(50, 175).lineTo(545, 175).stroke('#B8965A');

    let y = 190;
    const workout = plan.workout_plan;

    if (workout && workout.days) {
      for (const day of workout.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.fill('#B8965A').fontSize(13).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 50, y);
        y += 20;

        if (day.warmup) {
          doc.fill('#6B6B6B').fontSize(9).font('Helvetica')
            .text(`Warmup: ${day.warmup}`, 60, y);
          y += 14;
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
              .text(`→ ${ex.name}`, 60, y);
            doc.fill('#6B6B6B').fontSize(9)
              .text(`${ex.sets} × ${ex.reps} | Rest: ${ex.rest}`, 250, y);
            if (ex.notes) {
              doc.fill('#999999').fontSize(8)
                .text(ex.notes, 400, y);
            }
            y += 16;
          }
        }

        if (day.cooldown) {
          doc.fill('#6B6B6B').fontSize(9).font('Helvetica')
            .text(`Cooldown: ${day.cooldown}`, 60, y);
          y += 14;
        }

        y += 12;
      }
    }

    doc.addPage();

    doc.fill('#2C2C2C').fontSize(20).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, 50);
    doc.moveTo(50, 75).lineTo(545, 75).stroke('#B8965A');

    y = 90;
    const nutrition = plan.nutrition_plan;

    if (nutrition) {
      doc.fill('#2C2C2C').fontSize(11).font('Helvetica-Bold')
        .text('Daily Macros', 50, y);
      y += 18;

      const macros = [
        `Calories: ${nutrition.daily_calories} kcal`,
        `Protein: ${nutrition.protein_g}g`,
        `Carbs: ${nutrition.carbs_g}g`,
        `Fats: ${nutrition.fats_g}g`
      ];

      for (const m of macros) {
        doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
          .text(`• ${m}`, 60, y);
        y += 16;
      }

      y += 10;

      if (nutrition.meals) {
        doc.fill('#2C2C2C').fontSize(11).font('Helvetica-Bold')
          .text('Meal Plan', 50, y);
        y += 18;

        for (const meal of nutrition.meals) {
          if (y > 700) { doc.addPage(); y = 50; }
          doc.fill('#B8965A').fontSize(10).font('Helvetica-Bold')
            .text(meal.meal, 60, y);
          y += 15;

          if (meal.options) {
            for (const opt of meal.options) {
              doc.fill('#2C2C2C').fontSize(9).font('Helvetica')
                .text(`→ ${opt}`, 70, y);
              y += 14;
            }
          }
          y += 8;
        }
      }

      if (nutrition.hydration) {
        y += 5;
        doc.fill('#6B6B6B').fontSize(10).font('Helvetica')
          .text(`Hydration: ${nutrition.hydration}`, 50, y);
      }
    }

    const bottomY = doc.page.height - 40;
    doc.fill('#C8B89A').fontSize(8).font('Helvetica')
      .text('© Fitness by Maddy | fitnessbymaddy.com | Confidential — for client use only', 50, bottomY, { align: 'center' });

    doc.end();
  });
}
