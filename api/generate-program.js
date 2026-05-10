const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const supabase = require('../lib/supabase');
const { sendMediaMessage, notifyMaddy } = require('../lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000 calories', 'below 800',
  'clenbuterol', 'dnp', 'dinitrophenol', 'anabolic steroid',
  'ephedrine', 'sibutramine', 'fen-phen',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'water fast', 'zero calorie'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: existing } = await supabase
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Program already generated for this week' });
    }

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    let intakeData = null;
    try {
      const { data } = await supabase.storage
        .from('clients')
        .download(`clients/${client_id}/intake.json`);
      if (data) {
        const text = await data.text();
        intakeData = JSON.parse(text);
      }
    } catch (e) { /* no intake form yet */ }

    const prompt = buildPrompt(client, checkins || [], intakeData, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const rawOutput = response.content[0].text;

    const hasSafetyIssue = SAFETY_FLAGS.some(flag =>
      rawOutput.toLowerCase().includes(flag)
    );

    if (hasSafetyIssue) {
      await notifyMaddy(
        'Program flagged for review',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nReason: Safety flag triggered — review before sending.`
      );
      await supabase.from('programs').insert({
        client_id, week_no,
        workout_plan: { status: 'flagged', raw: rawOutput },
        nutrition_plan: { status: 'flagged' },
        notes: 'AUTO-FLAGGED: Safety review required'
      });
      return res.status(200).json({ status: 'flagged_for_review' });
    }

    let parsed;
    try {
      const jsonMatch = rawOutput.match(/```json\s*([\s\S]*?)```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : rawOutput);
    } catch (e) {
      parsed = { workout_plan: { raw: rawOutput }, nutrition_plan: {} };
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: urlData } = await supabase.storage
      .from('clients')
      .createSignedUrl(filePath, 60 * 60 * 24 * 7);

    const pdfUrl = urlData?.signedUrl || null;

    const { error: insertError } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan || parsed.workout || {},
      nutrition_plan: parsed.nutrition_plan || parsed.nutrition || {},
      notes: parsed.coach_notes || null
    });

    if (insertError) {
      console.error('Program insert error:', insertError.message);
    }

    if (pdfUrl) {
      const market = detectMarket(client.phone);
      let caption;
      if (isHinglish(market)) {
        caption = `💪 Week ${week_no} ka plan ready hai! ${parsed.coach_notes || 'Is hafte full power dena hai — Maddy believes in you! 🔥'}`;
      } else {
        caption = `💪 Your Week ${week_no} plan is ready! ${parsed.coach_notes || 'Give it your all this week — Maddy believes in you! 🔥'}`;
      }

      const sendResult = await sendMediaMessage(client.phone, pdfUrl, caption);

      if (sendResult.ok) {
        await supabase
          .from('programs')
          .update({ whatsapp_sent_at: new Date().toISOString() })
          .eq('client_id', client_id)
          .eq('week_no', week_no);
      }
    }

    return res.status(200).json({ status: 'generated', week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

function buildPrompt(client, checkins, intakeData, weekNo) {
  let context = `You are Maddy's AI program architect for FitnessByMaddy. Generate a personalized weekly training and nutrition plan.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
- Started: ${client.program_started_at}
`;

  if (intakeData) {
    context += `
INTAKE DATA:
- Age: ${intakeData.age || 'N/A'}
- Gender: ${intakeData.gender || 'N/A'}
- Goal: ${intakeData.goal || 'N/A'}
- Injuries: ${intakeData.injuries || 'None'}
- Diet: ${intakeData.diet_preference || 'No preference'}
- Schedule: ${intakeData.schedule || 'N/A'}
- Experience: ${intakeData.experience_level || 'N/A'}
- Current weight: ${intakeData.current_weight || 'N/A'}
- Target weight: ${intakeData.target_weight || 'N/A'}
- Medical: ${intakeData.medical_conditions || 'None'}
`;
  }

  if (checkins.length > 0) {
    context += '\nRECENT CHECK-INS:\n';
    for (const c of checkins) {
      context += `Week ${c.week_no}: Weight=${c.weight || 'N/A'}kg, Waist=${c.waist || 'N/A'}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues="${c.issues || 'None'}"\n`;
    }
  }

  context += `
RULES:
- Program must be safe, evidence-based, and realistic
- Never recommend extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Adapt based on compliance score and reported issues
- If injuries are reported, modify exercises accordingly
- Include warmup and cooldown in workout plan
- Nutrition should include flexible options, not rigid meal plans

OUTPUT FORMAT: Return valid JSON wrapped in \`\`\`json ... \`\`\` with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min light cardio + dynamic stretches",
        "cooldown": "5 min static stretches"
      }
    ],
    "rest_days": ["Sunday"],
    "weekly_cardio": "3x 20 min moderate intensity"
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "macros": { "protein_g": 150, "carbs_g": 200, "fats_g": 65 },
    "meal_timing": ["8am breakfast", "12pm lunch", "4pm snack", "7pm dinner"],
    "sample_meals": {
      "breakfast": ["Oats with protein powder and banana", "Egg whites with toast"],
      "lunch": ["Grilled chicken with rice and veggies", "Dal with roti and salad"],
      "dinner": ["Fish with sweet potato", "Paneer stir-fry with quinoa"]
    },
    "hydration": "3-4 liters water daily",
    "supplements": ["Whey protein", "Creatine 5g daily", "Vitamin D3"]
  },
  "coach_notes": "One-liner motivational note for the client"
}`;

  return context;
}

function generatePDF(client, plan, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, doc.page.width, 80).fill('#2C2C2C');
    doc.fontSize(28).font('Helvetica-Bold').fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fillColor('#FFFFFF')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    doc.moveDown(3);

    // Client info
    doc.fillColor('#2C2C2C').fontSize(12).font('Helvetica-Bold')
      .text(`Client: ${client.name || 'Client'}`, 50);
    doc.fontSize(10).font('Helvetica').fillColor('#6B6B6B')
      .text(`Program: ${client.program} | Week ${weekNo}`, 50);
    doc.moveDown(1.5);

    // Divider
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor('#B8965A').lineWidth(2).stroke();
    doc.moveDown(1);

    // Workout Plan
    doc.fillColor('#2C2C2C').fontSize(18).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    const workout = plan.workout_plan || plan.workout || {};
    const days = workout.days || [];

    for (const day of days) {
      doc.fillColor('#B8965A').fontSize(13).font('Helvetica-Bold')
        .text(`${day.day} — ${day.focus || ''}`, 50);

      if (day.warmup) {
        doc.fillColor('#6B6B6B').fontSize(9).font('Helvetica')
          .text(`Warmup: ${day.warmup}`, 60);
      }

      const exercises = day.exercises || [];
      for (const ex of exercises) {
        doc.fillColor('#2C2C2C').fontSize(10).font('Helvetica')
          .text(`  ${ex.name}  —  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}`, 60);
        if (ex.notes) {
          doc.fillColor('#6B6B6B').fontSize(8).text(`    ${ex.notes}`, 70);
        }
      }

      if (day.cooldown) {
        doc.fillColor('#6B6B6B').fontSize(9).font('Helvetica')
          .text(`Cooldown: ${day.cooldown}`, 60);
      }

      doc.moveDown(0.5);

      if (doc.y > doc.page.height - 120) {
        doc.addPage();
      }
    }

    if (workout.weekly_cardio) {
      doc.fillColor('#2C2C2C').fontSize(10).font('Helvetica-Bold')
        .text(`Cardio: ${workout.weekly_cardio}`, 50);
    }
    if (workout.rest_days) {
      doc.fillColor('#6B6B6B').fontSize(10).font('Helvetica')
        .text(`Rest Days: ${workout.rest_days.join(', ')}`, 50);
    }

    doc.moveDown(1.5);

    // Divider
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor('#B8965A').lineWidth(2).stroke();
    doc.moveDown(1);

    // Nutrition Plan
    if (doc.y > doc.page.height - 200) doc.addPage();

    doc.fillColor('#2C2C2C').fontSize(18).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);

    const nutrition = plan.nutrition_plan || plan.nutrition || {};

    if (nutrition.daily_calories) {
      doc.fillColor('#B8965A').fontSize(12).font('Helvetica-Bold')
        .text(`Daily Target: ${nutrition.daily_calories} kcal`, 50);
    }

    if (nutrition.macros) {
      const m = nutrition.macros;
      doc.fillColor('#2C2C2C').fontSize(10).font('Helvetica')
        .text(`Protein: ${m.protein_g}g  |  Carbs: ${m.carbs_g}g  |  Fats: ${m.fats_g}g`, 50);
    }

    doc.moveDown(0.5);

    if (nutrition.sample_meals) {
      for (const [meal, options] of Object.entries(nutrition.sample_meals)) {
        doc.fillColor('#B8965A').fontSize(11).font('Helvetica-Bold')
          .text(meal.charAt(0).toUpperCase() + meal.slice(1), 50);
        const opts = Array.isArray(options) ? options : [options];
        for (const opt of opts) {
          doc.fillColor('#2C2C2C').fontSize(10).font('Helvetica')
            .text(`  • ${opt}`, 60);
        }
        doc.moveDown(0.3);
      }
    }

    if (nutrition.hydration) {
      doc.moveDown(0.5);
      doc.fillColor('#6B6B6B').fontSize(10).font('Helvetica')
        .text(`Hydration: ${nutrition.hydration}`, 50);
    }

    if (nutrition.supplements && nutrition.supplements.length > 0) {
      doc.fillColor('#6B6B6B').fontSize(10)
        .text(`Supplements: ${nutrition.supplements.join(', ')}`, 50);
    }

    // Coach notes
    if (plan.coach_notes) {
      doc.moveDown(1.5);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor('#E8E3DC').lineWidth(1).stroke();
      doc.moveDown(0.5);
      doc.fillColor('#B8965A').fontSize(11).font('Helvetica-BoldOblique')
        .text(`"${plan.coach_notes}"`, 50, doc.y, { align: 'center', width: doc.page.width - 100 });
    }

    // Footer
    const bottomY = doc.page.height - 40;
    doc.fillColor('#C8B89A').fontSize(8).font('Helvetica')
      .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, bottomY, { align: 'center', width: doc.page.width - 100 });

    doc.end();
  });
}
