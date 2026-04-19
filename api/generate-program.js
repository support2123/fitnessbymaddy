const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { sendMedia } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/mask-phone');
const { escalateToMaddy } = require('../lib/escalation');
const PDFDocument = require('pdfkit');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some((flag) => lower.includes(flag));
}

async function generatePlan(client, checkins, weekNo) {
  const lastCheckins = checkins.slice(-2);
  const checkinSummary = lastCheckins.map((c) =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  const prompt = `You are a certified fitness program architect for FitnessByMaddy.
Design Week ${weekNo} of a 12-week custom training program.

CLIENT PROFILE:
- Name: ${client.name}
- Program: 12-Week Custom Training
- Started: ${client.program_started_at}

RECENT CHECK-IN DATA:
${checkinSummary || 'No prior check-ins (Week 1)'}

REQUIREMENTS:
1. Create a 6-day workout split (1 rest day)
2. Each day: exercise name, sets, reps, rest time, RPE
3. Progressive overload from previous weeks
4. Nutrition plan: daily calories, protein/carb/fat split, 3 meals + 1 snack
5. Keep calories realistic (never below 1200 for women, 1500 for men)
6. Address any issues mentioned in check-ins
7. Include a motivational note for the week

OUTPUT FORMAT (strict JSON):
{
  "workout_plan": {
    "days": [
      {
        "day": 1,
        "focus": "Upper Body Push",
        "exercises": [
          {"name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "rpe": 8}
        ]
      }
    ],
    "rest_day": 7
  },
  "nutrition_plan": {
    "daily_calories": 2200,
    "protein_g": 165,
    "carbs_g": 250,
    "fat_g": 70,
    "meals": [
      {"meal": "Breakfast", "description": "..."},
      {"meal": "Lunch", "description": "..."},
      {"meal": "Snack", "description": "..."},
      {"meal": "Dinner", "description": "..."}
    ]
  },
  "weekly_note": "..."
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text;

  if (hasSafetyIssue(text)) {
    return { safe: false, raw: text };
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { safe: false, raw: text, error: 'No JSON found in response' };
  }

  const plan = JSON.parse(jsonMatch[0]);
  return { safe: true, plan };
}

async function generatePDF(client, plan, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fillColor('#FFFFFF')
      .text(`WEEK ${weekNo} — ${client.name}`, 50, 75, { align: 'center' });

    let y = 150;

    doc.fontSize(18).fillColor('#2C2C2C')
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    if (plan.workout_plan?.days) {
      for (const day of plan.workout_plan.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.fontSize(13).fillColor('#B8965A')
          .text(`DAY ${day.day} — ${day.focus}`, 50, y);
        y += 20;

        for (const ex of day.exercises || []) {
          if (y > 730) { doc.addPage(); y = 50; }
          doc.fontSize(10).fillColor('#2C2C2C')
            .text(`${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}  |  RPE ${ex.rpe}`, 70, y);
          y += 16;
        }
        y += 10;
      }
    }

    if (y > 600) { doc.addPage(); y = 50; }

    y += 20;
    doc.fontSize(18).fillColor('#2C2C2C')
      .text('NUTRITION PLAN', 50, y);
    y += 30;

    if (plan.nutrition_plan) {
      const np = plan.nutrition_plan;
      doc.fontSize(11).fillColor('#B8965A')
        .text(`Daily Target: ${np.daily_calories} kcal  |  P: ${np.protein_g}g  |  C: ${np.carbs_g}g  |  F: ${np.fat_g}g`, 50, y);
      y += 25;

      for (const meal of np.meals || []) {
        if (y > 730) { doc.addPage(); y = 50; }
        doc.fontSize(11).fillColor('#2C2C2C')
          .text(`${meal.meal}: ${meal.description}`, 70, y, { width: 460 });
        y += doc.heightOfString(`${meal.meal}: ${meal.description}`, { width: 460 }) + 8;
      }
    }

    if (plan.weekly_note) {
      if (y > 650) { doc.addPage(); y = 50; }
      y += 20;
      doc.rect(50, y, doc.page.width - 100, 2).fill('#B8965A');
      y += 15;
      doc.fontSize(10).fillColor('#6B6B6B')
        .text(plan.weekly_note, 50, y, { width: 500, align: 'center' });
    }

    doc.end();
  });
}

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
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: true });

    const result = await generatePlan(client, checkins || [], week_no);

    if (!result.safe) {
      await escalateToMaddy(
        client.phone,
        'Program flagged for safety review',
        result.error || result.raw?.substring(0, 300) || 'Unknown issue'
      );
      return res.status(200).json({ action: 'flagged_for_review', client_id });
    }

    const pdfBuffer = await generatePDF(client, result.plan, week_no);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: publicUrl } = supabase.storage
      .from('programs')
      .getPublicUrl(filePath);

    const pdfUrl = publicUrl?.publicUrl || filePath;

    await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: result.plan.workout_plan,
      nutrition_plan: result.plan.nutrition_plan,
      notes: result.plan.weekly_note,
    });

    await sendMedia(
      client.phone,
      pdfUrl,
      `Week ${week_no} program is ready! 💪 ${result.plan.weekly_note || ''}`
    );

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);

    return res.status(200).json({
      action: 'generated',
      client_id,
      week_no,
      pdf_url: pdfUrl,
    });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
