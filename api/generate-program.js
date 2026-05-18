const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000 cal', 'below 800 cal',
  'clenbuterol', 'dnp', 'dinitrophenol', 'sarm', 'steroid',
  'ephedra', 'sibutramine', 'lose 10kg in 1 week',
  'crash diet', 'water fast extended'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
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

    let intakeData = null;
    try {
      const { data: intakeBlob } = await db.storage
        .from('intake-forms')
        .download(`${client.lead_id}.json`);
      if (intakeBlob) {
        intakeData = JSON.parse(await intakeBlob.text());
      }
    } catch (e) { /* no intake data available */ }

    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      started: client.program_started_at,
      intake: intakeData,
      recent_checkins: recentCheckins || []
    };

    const anthropic = new Anthropic();

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: buildProgramPrompt(clientProfile)
      }]
    });

    const programText = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = programText.match(/```json\n?([\s\S]*?)\n?```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : programText);
    } catch (e) {
      parsed = { workout_plan: { raw: programText }, nutrition_plan: {} };
    }

    const outputText = JSON.stringify(parsed).toLowerCase();
    for (const flag of SAFETY_FLAGS) {
      if (outputText.includes(flag)) {
        const { escalate } = require('./lib/escalation');
        await escalate(
          client.phone,
          `Safety flag in generated program: "${flag}"`,
          `Week ${week_no} program for ${client.name} flagged`,
          client_id
        );
        return res.status(200).json({
          ok: false,
          reason: 'safety_flagged',
          flag
        });
      }
    }

    const pdfBuffer = await generatePDF(client, week_no, parsed);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: { publicUrl } } = db.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const { error: programError } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: publicUrl,
      workout_plan: parsed.workout_plan || parsed,
      nutrition_plan: parsed.nutrition_plan || {},
      notes: parsed.coach_notes || null,
      generated_at: new Date().toISOString()
    });

    if (programError) {
      console.error('Program insert error:', programError.message);
    }

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      publicUrl
    ]);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({
      ok: true,
      program_id: client_id,
      week_no,
      pdf_url: publicUrl
    });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildProgramPrompt(profile) {
  const checkinSummary = profile.recent_checkins.map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
  ).join('\n') || 'No previous check-ins.';

  const intakeInfo = profile.intake
    ? `Age: ${profile.intake.age}, Goal: ${profile.intake.goal}, Injuries: ${profile.intake.injuries || 'none'}, Diet: ${profile.intake.diet_pref || 'flexible'}, Schedule: ${profile.intake.schedule || 'flexible'}, Experience: ${profile.intake.experience || 'beginner'}, Weight: ${profile.intake.current_weight}kg, Target: ${profile.intake.target_weight}kg, Height: ${profile.intake.height}cm`
    : 'No intake data available.';

  return `You are an expert fitness program architect for Fitness by Maddy, a premium online coaching brand.

Generate Week ${profile.week} of a ${profile.program} program for client "${profile.name}".

CLIENT PROFILE:
${intakeInfo}

RECENT CHECK-INS:
${checkinSummary}

RULES:
- Create a safe, science-backed program
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Progressively overload from previous weeks
- Include warm-up and cool-down
- Consider any injuries or limitations mentioned
- Be specific with sets, reps, rest periods, and exercise names

Respond ONLY with valid JSON in this format:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "warmup": "5 min light cardio + dynamic stretches",
        "exercises": [
          { "name": "Barbell Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cooldown": "5 min stretching"
      }
    ],
    "rest_days": ["Sunday"],
    "weekly_cardio": "3x 20-min LISS or 2x 15-min HIIT"
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 67,
    "meal_timing": ["8am breakfast", "12pm lunch", "4pm snack", "7pm dinner"],
    "sample_meals": {
      "breakfast": "Oats with protein powder, banana, and almonds",
      "lunch": "Grilled chicken, brown rice, mixed vegetables",
      "snack": "Greek yogurt with berries",
      "dinner": "Salmon, sweet potato, steamed broccoli"
    },
    "hydration": "3-4 liters water daily",
    "supplements": ["Whey protein", "Creatine 5g daily", "Vitamin D3"]
  },
  "coach_notes": "Brief personalized note for the client about focus this week."
}
\`\`\``;
}

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fillColor('#B8965A').text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fillColor('#FFFFFF').text(`Week ${weekNo} Program`, 50, 72, { align: 'center' });
    doc.fontSize(10).fillColor('#D4AF7A').text(
      `${client.name || 'Client'} | ${client.program?.toUpperCase()} | ${new Date().toLocaleDateString()}`,
      50, 94, { align: 'center' }
    );

    doc.moveDown(3);

    if (programData.workout_plan?.days) {
      doc.fontSize(18).fillColor('#2C2C2C').text('WORKOUT PLAN');
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
      doc.moveDown(0.5);

      for (const day of programData.workout_plan.days) {
        if (doc.y > 700) { doc.addPage(); }
        doc.fontSize(13).fillColor('#B8965A').text(`${day.day} — ${day.focus}`);
        doc.moveDown(0.3);

        if (day.warmup) {
          doc.fontSize(9).fillColor('#6B6B6B').text(`Warm-up: ${day.warmup}`);
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (doc.y > 720) { doc.addPage(); }
            doc.fontSize(10).fillColor('#2C2C2C')
              .text(`  ${ex.name}  —  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`, { indent: 10 });
            if (ex.notes) {
              doc.fontSize(8).fillColor('#6B6B6B').text(`    ${ex.notes}`, { indent: 20 });
            }
          }
        }

        if (day.cooldown) {
          doc.fontSize(9).fillColor('#6B6B6B').text(`Cool-down: ${day.cooldown}`);
        }
        doc.moveDown(0.8);
      }

      if (programData.workout_plan.weekly_cardio) {
        doc.moveDown(0.3);
        doc.fontSize(10).fillColor('#2C2C2C').text(`Weekly Cardio: ${programData.workout_plan.weekly_cardio}`);
      }
    }

    if (programData.nutrition_plan) {
      doc.addPage();
      doc.rect(0, 0, doc.page.width, 60).fill('#2C2C2C');
      doc.fontSize(18).fillColor('#B8965A').text('NUTRITION PLAN', 50, 20, { align: 'center' });

      doc.moveDown(2);
      const np = programData.nutrition_plan;

      if (np.daily_calories) {
        doc.fontSize(12).fillColor('#2C2C2C').text('Daily Targets');
        doc.moveDown(0.3);
        doc.fontSize(10).fillColor('#6B6B6B')
          .text(`Calories: ${np.daily_calories} kcal  |  Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fats: ${np.fats_g}g`);
        doc.moveDown(0.8);
      }

      if (np.sample_meals) {
        doc.fontSize(12).fillColor('#2C2C2C').text('Sample Meals');
        doc.moveDown(0.3);
        for (const [meal, desc] of Object.entries(np.sample_meals)) {
          doc.fontSize(10).fillColor('#B8965A').text(meal.charAt(0).toUpperCase() + meal.slice(1), { continued: true });
          doc.fillColor('#6B6B6B').text(`: ${desc}`);
        }
        doc.moveDown(0.8);
      }

      if (np.hydration) {
        doc.fontSize(10).fillColor('#2C2C2C').text(`Hydration: ${np.hydration}`);
      }
      if (np.supplements?.length) {
        doc.fontSize(10).fillColor('#2C2C2C').text(`Supplements: ${np.supplements.join(', ')}`);
      }
    }

    if (programData.coach_notes) {
      doc.moveDown(1.5);
      doc.rect(50, doc.y, 495, 60).fill('#FAF8F4').stroke('#B8965A');
      doc.fontSize(10).fillColor('#2C2C2C')
        .text(`Coach's Note: ${programData.coach_notes}`, 60, doc.y - 50, { width: 475 });
    }

    doc.end();
  });
}
