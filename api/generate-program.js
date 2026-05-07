const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 800', 'below 1000', 'starvation',
  'clenbuterol', 'dnp', 'dinitrophenol', 'ephedra', 'sarm',
  'steroid', 'anabolic', 'testosterone injection',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*, leads(*)')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: existingProgram } = await supabase
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .limit(1)
      .single();

    if (existingProgram) {
      return res.status(200).json({ message: 'Program already exists for this week' });
    }

    const anthropic = new Anthropic();

    const systemPrompt = `You are a certified personal trainer and nutrition coach creating weekly programs for Fitness by Maddy clients. You create safe, evidence-based, personalised workout and nutrition plans.

RULES:
- Never recommend extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances, steroids, or unproven supplements
- Never promise unrealistic timelines (max 1kg/week fat loss)
- Base progressive overload on client's reported compliance and energy
- If compliance is low (<5), simplify the plan rather than intensify
- If energy is low (<4), reduce volume and add deload days
- Always include warm-up and cool-down protocols
- Structure output as valid JSON`;

    const userPrompt = buildPrompt(client, recentCheckins, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawOutput = response.content[0].text;

    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    if (hasSafetyViolation(rawOutput)) {
      const { sendTemplate: notify } = require('../lib/whatsapp');
      await notify('+917082478374', 'escalation_alert', [
        'Safety flag in generated program',
        client.phone.slice(0, 3) + 'XXX...' + client.phone.slice(-3),
        `Week ${week_no} program flagged for review`,
      ]);
      return res.status(200).json({ flagged: true, message: 'Program flagged for Maddy review' });
    }

    const pdfBuffer = await generatePDF(client, programData, week_no);

    const fileName = `week_${week_no}.pdf`;
    const storagePath = `clients/${client_id}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('programs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('[generate-program] upload error:', uploadError.message);
    }

    const { data: urlData } = supabase.storage
      .from('programs')
      .getPublicUrl(storagePath);

    const pdfUrl = urlData?.publicUrl || storagePath;

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        pdf_url: pdfUrl,
        workout_plan: programData.workout_plan || programData.workout,
        nutrition_plan: programData.nutrition_plan || programData.nutrition,
        notes: programData.notes || '',
      })
      .select()
      .single();

    const market = client.leads?.market || 'IN';
    const template = isHinglish(market) ? 'weekly_program' : 'weekly_program_en';
    const contextNote = programData.notes || `Week ${week_no} program ready!`;
    await sendTemplate(client.phone, template, [
      client.name || 'there',
      String(week_no),
      contextNote.slice(0, 100),
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, programId: program.id, pdfUrl });
  } catch (err) {
    console.error('[generate-program]', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

function buildPrompt(client, checkins, weekNo) {
  const profile = {
    name: client.name,
    program: client.program,
    week: weekNo,
    started: client.program_started_at,
  };

  let checkinSummary = 'No previous check-in data.';
  if (checkins && checkins.length > 0) {
    checkinSummary = checkins.map(c =>
      `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
    ).join('\n');
  }

  return `Create a Week ${weekNo} program for this client.

CLIENT PROFILE:
${JSON.stringify(profile, null, 2)}

RECENT CHECK-INS:
${checkinSummary}

Return a JSON object with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "warmup": "5 min light cardio + dynamic stretches",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cooldown": "5 min static stretching"
      }
    ],
    "rest_days": ["Sunday"],
    "cardio": { "type": "LISS", "duration": "20 min", "frequency": "3x/week" }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 73,
    "meal_timing": ["8am breakfast", "12pm lunch", "4pm snack", "8pm dinner"],
    "hydration": "3-4L water daily",
    "supplements": ["whey protein", "creatine 5g", "vitamin D"]
  },
  "notes": "One-liner context note for WhatsApp message"
}`;
}

function hasSafetyViolation(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

async function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const gold = '#B8965A';
    const charcoal = '#2C2C2C';

    doc.rect(0, 0, doc.page.width, 120).fill(charcoal);
    doc.fontSize(28).fill('#FFFFFF').text('FITNESS BY MADDY', 50, 35, { align: 'left' });
    doc.fontSize(14).fill(gold).text(`WEEK ${weekNo} PROGRAM`, 50, 75, { align: 'left' });
    doc.fontSize(10).fill('#AAAAAA').text(client.name || 'Client', 50, 95, { align: 'left' });

    doc.moveDown(3);

    const workout = programData.workout_plan || programData.workout;
    if (workout && workout.days) {
      doc.fontSize(18).fill(gold).text('WORKOUT PLAN', 50);
      doc.moveDown(0.5);

      for (const day of workout.days) {
        doc.fontSize(13).fill(charcoal).text(`${day.day} — ${day.focus}`, 50);
        doc.fontSize(9).fill('#888888').text(`Warm-up: ${day.warmup || 'Dynamic stretching'}`, 60);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill(charcoal).text(
              `• ${ex.name}  —  ${ex.sets} × ${ex.reps}  (rest: ${ex.rest || '60s'})`,
              70
            );
            if (ex.notes) {
              doc.fontSize(8).fill('#888888').text(`  ${ex.notes}`, 80);
            }
          }
        }

        doc.fontSize(9).fill('#888888').text(`Cool-down: ${day.cooldown || 'Static stretching'}`, 60);
        doc.moveDown(0.5);
      }

      if (workout.cardio) {
        doc.moveDown(0.3);
        doc.fontSize(10).fill(charcoal).text(
          `Cardio: ${workout.cardio.type} — ${workout.cardio.duration}, ${workout.cardio.frequency}`, 50
        );
      }
    }

    const nutrition = programData.nutrition_plan || programData.nutrition;
    if (nutrition) {
      doc.moveDown(1);
      doc.fontSize(18).fill(gold).text('NUTRITION PLAN', 50);
      doc.moveDown(0.5);

      doc.fontSize(11).fill(charcoal).text(
        `Daily Targets: ${nutrition.calories} kcal | ${nutrition.protein_g}g protein | ${nutrition.carbs_g}g carbs | ${nutrition.fat_g}g fat`,
        50
      );

      if (nutrition.meal_timing) {
        doc.moveDown(0.3);
        doc.fontSize(10).fill('#555555').text('Meal Timing:', 50);
        for (const meal of nutrition.meal_timing) {
          doc.fontSize(10).fill(charcoal).text(`  • ${meal}`, 60);
        }
      }

      if (nutrition.hydration) {
        doc.moveDown(0.3);
        doc.fontSize(10).fill(charcoal).text(`Hydration: ${nutrition.hydration}`, 50);
      }

      if (nutrition.supplements) {
        doc.moveDown(0.3);
        doc.fontSize(10).fill(charcoal).text(`Supplements: ${nutrition.supplements.join(', ')}`, 50);
      }
    }

    if (programData.notes) {
      doc.moveDown(1);
      doc.fontSize(10).fill(gold).text('Coach Notes:', 50);
      doc.fontSize(10).fill(charcoal).text(programData.notes, 50);
    }

    const bottomY = doc.page.height - 40;
    doc.fontSize(8).fill('#AAAAAA').text(
      'Fitness by Maddy — fitnessbymaddy.com — This program is personalized and confidential.',
      50, bottomY, { align: 'center', width: doc.page.width - 100 }
    );

    doc.end();
  });
}
