const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/market');
const { escalateToMaddy } = require('./lib/escalation');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'steroid', 'sarm', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in',
  'starvation', 'water fast for',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intake } = await db
      .from('lead_intake')
      .select('*')
      .eq('lead_id', client.lead_id)
      .single();

    const prompt = buildPrompt(client, intake, recentCheckins, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const planText = response.content[0].text;

    const lowerPlan = planText.toLowerCase();
    const flagged = SAFETY_FLAGS.some((f) => lowerPlan.includes(f));
    if (flagged) {
      await escalateToMaddy(
        'Program generation safety flag',
        client.phone,
        `Week ${week_no} plan contains risky content — needs manual review`
      );
      return res.status(200).json({ ok: false, reason: 'safety_flagged', client_id });
    }

    let parsed;
    try {
      const jsonMatch = planText.match(/```json\s*([\s\S]*?)\s*```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : planText);
    } catch {
      parsed = { raw: planText };
    }

    const workout = parsed.workout_plan || parsed.workout || parsed.raw || planText;
    const nutrition = parsed.nutrition_plan || parsed.nutrition || {};

    const pdfBuffer = await generatePDF(client, week_no, workout, nutrition);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: publicUrl } = db.storage.from('programs').getPublicUrl(filePath);

    const { error: insertError } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: publicUrl?.publicUrl || filePath,
      workout_plan: typeof workout === 'string' ? { text: workout } : workout,
      nutrition_plan: typeof nutrition === 'string' ? { text: nutrition } : nutrition,
      notes: `Auto-generated for week ${week_no}`,
    });

    if (insertError) {
      console.error('Program insert error:', insertError.message);
    }

    await sendTemplate(client.phone, 'program_ready', [
      client.name || 'there',
      String(week_no),
      publicUrl?.publicUrl || `Week ${week_no} program ready`,
    ]);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, client_id, week_no, pdf_url: publicUrl?.publicUrl });
  } catch (err) {
    console.error('Program gen error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const clientInfo = [
    `Client: ${client.name || 'Unknown'}`,
    `Program: ${client.program}`,
    `Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}`,
    intake?.goal ? `Goal: ${intake.goal}` : '',
    intake?.injuries ? `Injuries/Limitations: ${intake.injuries}` : '',
    intake?.diet_pref ? `Diet preference: ${intake.diet_pref}` : '',
    intake?.experience_level ? `Experience: ${intake.experience_level}` : '',
    intake?.schedule ? `Schedule: ${intake.schedule}` : '',
    intake?.age ? `Age: ${intake.age}` : '',
    intake?.gender ? `Gender: ${intake.gender}` : '',
  ].filter(Boolean).join('\n');

  const checkinInfo = (checkins || []).map((c) =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, ` +
    `compliance=${c.compliance_score}/10, energy=${c.energy}/10` +
    (c.issues ? `, issues: ${c.issues}` : '')
  ).join('\n');

  return `You are Maddy's program architect — an expert fitness coach creating weekly training and nutrition plans.

CLIENT PROFILE:
${clientInfo}

RECENT CHECK-INS:
${checkinInfo || 'No previous check-ins (first week)'}

Create a complete Week ${weekNo} program. Return valid JSON with this structure:
{
  "workout_plan": {
    "overview": "Brief weekly focus",
    "days": [
      {
        "day": "Day 1 - Upper Body",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min cardio + dynamic stretching",
        "cooldown": "5 min static stretching"
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "example": "4 eggs, 2 toast, avocado", "macros": "P35 C40 F20" }
    ],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein", "Creatine 5g"]
  },
  "coach_note": "One-liner motivational context for the week"
}

RULES:
- Never recommend below 1200 calories for women or 1500 for men
- No banned substances, steroids, or SARMs
- Account for injuries/limitations mentioned
- Progressive overload from previous weeks if check-in data available
- Keep it realistic and sustainable
- If compliance was low, simplify the plan
- If energy was low, reduce volume slightly`;
}

async function generatePDF(client, weekNo, workout, nutrition) {
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
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75, { align: 'center' });
    doc.fontSize(10).fillColor('#D4AF7A')
      .text(client.name || 'Client Program', 50, 95, { align: 'center' });

    doc.moveDown(4);

    doc.fontSize(18).fillColor('#2C2C2C')
      .text('WORKOUT PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#B8965A').stroke();
    doc.moveDown(0.5);

    if (typeof workout === 'object' && workout.days) {
      if (workout.overview) {
        doc.fontSize(11).fillColor('#6B6B6B').text(workout.overview);
        doc.moveDown(0.5);
      }

      for (const day of workout.days) {
        doc.fontSize(13).fillColor('#B8965A').text(day.day || 'Training Day');
        if (day.warmup) {
          doc.fontSize(9).fillColor('#6B6B6B').text(`Warm-up: ${day.warmup}`);
        }
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            const line = `${ex.name} — ${ex.sets}x${ex.reps}` +
              (ex.rest ? ` | Rest: ${ex.rest}` : '') +
              (ex.notes ? ` | ${ex.notes}` : '');
            doc.fontSize(10).fillColor('#2C2C2C').text(`  ${line}`);
          }
        }

        if (day.cooldown) {
          doc.fontSize(9).fillColor('#6B6B6B').text(`Cool-down: ${day.cooldown}`);
        }
        doc.moveDown(0.5);
      }
    } else {
      const text = typeof workout === 'string' ? workout : JSON.stringify(workout, null, 2);
      doc.fontSize(10).fillColor('#2C2C2C').text(text, { width: 495 });
    }

    if (doc.y > 650) doc.addPage();
    doc.moveDown(1);

    doc.fontSize(18).fillColor('#2C2C2C').text('NUTRITION PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#B8965A').stroke();
    doc.moveDown(0.5);

    if (typeof nutrition === 'object' && nutrition.calories) {
      doc.fontSize(11).fillColor('#2C2C2C')
        .text(`Daily Targets: ${nutrition.calories} kcal | P: ${nutrition.protein_g}g | C: ${nutrition.carbs_g}g | F: ${nutrition.fat_g}g`);
      doc.moveDown(0.3);

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          doc.fontSize(10).fillColor('#B8965A').text(meal.meal);
          doc.fontSize(10).fillColor('#2C2C2C').text(`  ${meal.example}`);
          if (meal.macros) {
            doc.fontSize(9).fillColor('#6B6B6B').text(`  ${meal.macros}`);
          }
        }
      }

      doc.moveDown(0.5);
      if (nutrition.hydration) {
        doc.fontSize(10).fillColor('#6B6B6B').text(`Hydration: ${nutrition.hydration}`);
      }
      if (nutrition.supplements) {
        doc.fontSize(10).fillColor('#6B6B6B')
          .text(`Supplements: ${nutrition.supplements.join(', ')}`);
      }
    } else if (nutrition && Object.keys(nutrition).length > 0) {
      const text = typeof nutrition === 'string' ? nutrition : JSON.stringify(nutrition, null, 2);
      doc.fontSize(10).fillColor('#2C2C2C').text(text, { width: 495 });
    }

    doc.moveDown(2);

    const coachNote = typeof workout === 'object' && workout.coach_note
      ? workout.coach_note
      : 'Stay consistent. Trust the process.';

    doc.rect(50, doc.y, 495, 40).fill('#FAF8F4');
    doc.fontSize(10).fillColor('#B8965A')
      .text(coachNote, 60, doc.y - 30, { width: 475, align: 'center' });

    const bottomY = doc.page.height - 40;
    doc.fontSize(8).fillColor('#C8B89A')
      .text('fitnessbymaddy.com | This program is for personal use only.', 50, bottomY, { align: 'center' });

    doc.end();
  });
}
