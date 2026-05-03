const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { cors, parseBody } = require('./lib/helpers');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'steroids', 'sarms',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

function buildPrompt(client, checkins) {
  const latestCheckin = checkins[0] || {};
  const prevCheckin = checkins[1] || {};

  return `You are a certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Current week requesting: next week's plan

LATEST CHECK-IN (Week ${latestCheckin.week_no || 'N/A'}):
- Weight: ${latestCheckin.weight || 'N/A'} kg
- Waist: ${latestCheckin.waist || 'N/A'} cm
- Compliance: ${latestCheckin.compliance_score || 'N/A'}/10
- Energy: ${latestCheckin.energy || 'N/A'}/10
- Issues: ${latestCheckin.issues || 'None reported'}

PREVIOUS CHECK-IN (Week ${prevCheckin.week_no || 'N/A'}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Waist: ${prevCheckin.waist || 'N/A'} cm
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10
- Energy: ${prevCheckin.energy || 'N/A'}/10

Generate a JSON response with this exact structure:
{
  "workout_plan": {
    "split": "Description of training split",
    "days": [
      {
        "day": "Monday",
        "focus": "Muscle group",
        "exercises": [
          { "name": "Exercise name", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "cardio": "Cardio recommendations",
    "notes": "Any additional training notes"
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"] }
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "Water intake recommendation",
    "notes": "Any nutrition notes"
  },
  "weekly_focus": "One sentence focus for the week",
  "coach_note": "Personalized motivational note from coach"
}

RULES:
- Never recommend less than 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Base adjustments on check-in trends (weight, compliance, energy)
- If compliance is low, simplify the plan
- If energy is low, reduce volume slightly
- Be encouraging but realistic`;
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = await parseBody(req);
  const db = getSupabase();

  const clientId = body.client_id;
  const weekNo = parseInt(body.week_no, 10) || 1;

  if (!clientId) return res.status(400).json({ error: 'Missing client_id' });

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { data: checkins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  const prompt = buildPrompt(client, checkins || []);

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const claudeData = await claudeRes.json();
  const responseText = claudeData.content?.[0]?.text || '';

  if (hasSafetyIssue(responseText)) {
    const { createEscalation } = require('./lib/escalate');
    await createEscalation(
      client.phone,
      'AI generated unsafe program content',
      `Week ${weekNo} program flagged for safety review`
    );
    return res.status(200).json({ flagged: true, reason: 'Safety review needed' });
  }

  let workoutPlan = {};
  let nutritionPlan = {};
  let notes = '';

  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      workoutPlan = parsed.workout_plan || {};
      nutritionPlan = parsed.nutrition_plan || {};
      notes = parsed.coach_note || parsed.weekly_focus || '';
    }
  } catch {
    notes = 'Program generated — manual review recommended';
  }

  const PDFDocument = require('pdfkit');
  const pdfChunks = [];
  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  doc.on('data', chunk => pdfChunks.push(chunk));

  const pdfReady = new Promise(resolve => doc.on('end', resolve));

  doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
  doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 40);
  doc.fontSize(14).fill('#FFFFFF').text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 80);

  doc.moveDown(3);

  doc.fontSize(18).fill('#2C2C2C').text('WORKOUT PLAN', 50);
  doc.moveDown(0.5);
  doc.fontSize(11).fill('#6B6B6B').text(workoutPlan.split || 'Custom training split');
  doc.moveDown(0.5);

  if (workoutPlan.days && Array.isArray(workoutPlan.days)) {
    for (const day of workoutPlan.days) {
      doc.moveDown(0.3);
      doc.fontSize(13).fill('#B8965A').text(`${day.day} — ${day.focus}`);
      if (day.exercises && Array.isArray(day.exercises)) {
        for (const ex of day.exercises) {
          doc.fontSize(10).fill('#2C2C2C').text(
            `  ${ex.name}: ${ex.sets} x ${ex.reps} | Rest: ${ex.rest}${ex.notes ? ' | ' + ex.notes : ''}`,
            { indent: 20 }
          );
        }
      }
    }
  }

  doc.moveDown(1);
  doc.fontSize(18).fill('#2C2C2C').text('NUTRITION PLAN');
  doc.moveDown(0.5);

  if (nutritionPlan.calories) {
    doc.fontSize(12).fill('#2C2C2C').text(
      `Calories: ${nutritionPlan.calories} | Protein: ${nutritionPlan.protein_g}g | Carbs: ${nutritionPlan.carbs_g}g | Fats: ${nutritionPlan.fats_g}g`
    );
  }

  if (nutritionPlan.meals && Array.isArray(nutritionPlan.meals)) {
    doc.moveDown(0.5);
    for (const meal of nutritionPlan.meals) {
      doc.fontSize(12).fill('#B8965A').text(meal.meal);
      if (meal.options) {
        for (const opt of meal.options) {
          doc.fontSize(10).fill('#6B6B6B').text(`  - ${opt}`, { indent: 20 });
        }
      }
    }
  }

  if (notes) {
    doc.moveDown(1);
    doc.fontSize(12).fill('#2C2C2C').text('COACH NOTE:');
    doc.fontSize(11).fill('#6B6B6B').text(notes);
  }

  doc.end();
  await pdfReady;

  const pdfBuffer = Buffer.concat(pdfChunks);
  const pdfPath = `clients/${clientId}/week_${weekNo}.pdf`;

  await db.storage.from('client-files').upload(pdfPath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true
  });

  const { data: urlData } = db.storage.from('client-files').getPublicUrl(pdfPath);
  const pdfUrl = urlData?.publicUrl || '';

  const { data: program } = await db.from('programs').insert({
    client_id: clientId,
    week_no: weekNo,
    pdf_url: pdfUrl,
    workout_plan: workoutPlan,
    nutrition_plan: nutritionPlan,
    notes
  }).select().single();

  await sendTemplate(client.phone, 'weekly_program', {
    name: client.name || 'there',
    templateParams: [client.name || 'there', `${weekNo}`],
    media: { url: pdfUrl, filename: `week_${weekNo}_program.pdf` }
  });

  await db.from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('id', program.id);

  return res.status(200).json({ success: true, program_id: program.id, pdf_url: pdfUrl });
};
