const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate, detectMarket, isHinglish } = require('../lib/whatsapp');
const { parseBody, json, cors } = require('../lib/utils');
const { escalateToMaddy } = require('../lib/escalate');

const BANNED_TERMS = [
  'steroids', 'sarms', 'clenbuterol', 'dnp', 'ephedra',
  'under 800 calories', 'under 900 calories', 'under 1000 calories',
  'extreme fasting', 'water fast',
];

function hasDangerousContent(text) {
  const lower = text.toLowerCase();
  return BANNED_TERMS.some(term => lower.includes(term));
}

async function buildPrompt(client, checkins, intake) {
  let context = `You are a certified personal trainer and nutrition coach creating a weekly training and nutrition program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
`;

  if (intake) {
    context += `
INTAKE DATA:
${JSON.stringify(intake, null, 2)}
`;
  }

  if (checkins && checkins.length > 0) {
    context += `
RECENT CHECK-INS (last 2 weeks):
${checkins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n')}
`;
  }

  context += `
OUTPUT FORMAT:
Return a JSON object with exactly this structure:
{
  "workout_plan": {
    "overview": "brief summary of this week's focus",
    "days": [
      {
        "day": "Day 1 - Push",
        "exercises": [
          { "name": "Barbell Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fats_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1 description", "Option 2 description"] }
    ],
    "notes": "any special dietary notes"
  },
  "coach_note": "A short motivational + strategic note for the client (2-3 sentences)"
}

RULES:
- Be realistic and safe. No extreme calorie deficits below 1200 for women or 1500 for men.
- No banned substances. No unrealistic timelines.
- Progressive overload each week based on check-in data.
- Adjust volume/intensity based on compliance and energy scores.
- If issues mention pain or injury, reduce load on affected areas.
- Return ONLY the JSON, no other text.`;

  return context;
}

async function generatePDF(weekNo, workoutPlan, nutritionPlan, coachNote, clientName) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 80).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 25);
    doc.fontSize(11).fill('#999999').text(`Week ${weekNo} Program | ${clientName || 'Client'}`, 50, 55);

    doc.moveDown(3);

    // Coach note
    if (coachNote) {
      doc.fontSize(12).fill('#B8965A').text('FROM YOUR COACH', 50);
      doc.moveDown(0.3);
      doc.fontSize(10).fill('#333333').text(coachNote, 50, undefined, { width: 495 });
      doc.moveDown(1.5);
    }

    // Workout plan
    doc.fontSize(16).fill('#2C2C2C').text('WORKOUT PLAN', 50);
    doc.moveDown(0.3);
    if (workoutPlan.overview) {
      doc.fontSize(9).fill('#666666').text(workoutPlan.overview, 50, undefined, { width: 495 });
      doc.moveDown(0.8);
    }

    if (workoutPlan.days) {
      for (const day of workoutPlan.days) {
        if (doc.y > 680) doc.addPage();
        doc.fontSize(12).fill('#B8965A').text(day.day, 50);
        doc.moveDown(0.3);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(9).fill('#333333').text(
              `  ${ex.name}  —  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}${ex.notes ? '  |  ' + ex.notes : ''}`,
              60, undefined, { width: 480 }
            );
          }
        }
        doc.moveDown(0.8);
      }
    }

    // Nutrition plan
    if (doc.y > 600) doc.addPage();
    doc.moveDown(1);
    doc.fontSize(16).fill('#2C2C2C').text('NUTRITION PLAN', 50);
    doc.moveDown(0.3);

    if (nutritionPlan.calories) {
      doc.fontSize(10).fill('#333333').text(
        `Daily Targets:  ${nutritionPlan.calories} kcal  |  Protein: ${nutritionPlan.protein_g}g  |  Carbs: ${nutritionPlan.carbs_g}g  |  Fats: ${nutritionPlan.fats_g}g`,
        50
      );
      doc.moveDown(0.8);
    }

    if (nutritionPlan.meals) {
      for (const meal of nutritionPlan.meals) {
        if (doc.y > 700) doc.addPage();
        doc.fontSize(11).fill('#B8965A').text(meal.meal, 50);
        if (meal.options) {
          for (const opt of meal.options) {
            doc.fontSize(9).fill('#333333').text(`  → ${opt}`, 60, undefined, { width: 480 });
          }
        }
        doc.moveDown(0.5);
      }
    }

    if (nutritionPlan.notes) {
      doc.moveDown(0.5);
      doc.fontSize(9).fill('#666666').text(`Note: ${nutritionPlan.notes}`, 50, undefined, { width: 495 });
    }

    // Footer
    doc.moveDown(2);
    doc.fontSize(8).fill('#999999').text(
      'Generated by Fitness by Maddy | fitnessbymaddy.com | This program is personalized — do not share.',
      50, undefined, { width: 495, align: 'center' }
    );

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return json(res, 401, { error: 'unauthorized' });
  }

  const body = await parseBody(req);
  const { client_id, week_no } = body;

  if (!client_id || !week_no) {
    return json(res, 400, { error: 'client_id and week_no required' });
  }

  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return json(res, 404, { error: 'client not found' });

  const { data: checkins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  let intake = null;
  try {
    const { data: intakeFile } = await db.storage
      .from('clients')
      .download(`intakes/${client.lead_id}.json`);
    if (intakeFile) {
      intake = JSON.parse(await intakeFile.text());
    }
  } catch (_) {}

  const prompt = await buildPrompt(client, checkins, intake);

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const responseText = response.content[0].text;

  if (hasDangerousContent(responseText)) {
    await escalateToMaddy(
      'Dangerous content in generated program',
      `Client: ${client.id}\nWeek: ${week_no}\nFlagged content detected — program NOT sent.`
    );
    return json(res, 422, { error: 'content_flagged', message: 'Program flagged for review' });
  }

  let parsed;
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return json(res, 500, { error: 'failed to parse Claude response' });
  }

  const { workout_plan, nutrition_plan, coach_note } = parsed;

  const pdfBuffer = await generatePDF(week_no, workout_plan, nutrition_plan, coach_note, client.name);

  const pdfPath = `${client.id}/week_${week_no}.pdf`;
  await db.storage.from('clients').upload(pdfPath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true,
  });

  const { data: signedUrl } = await db.storage
    .from('clients')
    .createSignedUrl(pdfPath, 60 * 60 * 24 * 7);

  await db.from('programs').insert({
    client_id,
    week_no: parseInt(week_no),
    generated_at: new Date().toISOString(),
    pdf_url: pdfPath,
    workout_plan,
    nutrition_plan,
    notes: coach_note,
  });

  const market = detectMarket(client.phone);
  const hinglish = isHinglish(market);

  const msg = hinglish
    ? [`Week ${week_no} ka program ready hai! Download karo: ${signedUrl.signedUrl}`]
    : [`Your Week ${week_no} program is ready! Download here: ${signedUrl.signedUrl}`];

  await sendTemplate(client.phone, 'weekly_program', msg);

  await db.from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('client_id', client_id)
    .eq('week_no', parseInt(week_no));

  return json(res, 200, { ok: true, pdf_url: pdfPath, week_no });
};
