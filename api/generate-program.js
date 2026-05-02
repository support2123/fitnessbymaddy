const Anthropic = require('@anthropic-ai/sdk');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { supabase } = require('./_lib/supabase');
const { sendWhatsAppWithRateLimit } = require('./_lib/whatsapp');
const { cors, parseBody, maskPhone } = require('./_lib/helpers');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

const RISKY_TERMS = [
  'extreme calorie', 'under 1000 cal', 'under 800 cal',
  'starvation', 'clenbuterol', 'dnp', 'dinitrophenol',
  'anabolic steroid', 'sarm', 'hgh', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

function containsRiskyContent(text) {
  const lower = text.toLowerCase();
  return RISKY_TERMS.some(term => lower.includes(term));
}

async function generateWithClaude(client, checkins) {
  const anthropic = new Anthropic();

  const clientProfile = `
Client: ${client.name || 'Unknown'}
Program: ${client.program}
Started: ${client.program_started_at}
`.trim();

  const checkinSummary = checkins.map(c => `
Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm
Compliance: ${c.compliance_score || 'N/A'}/10, Energy: ${c.energy || 'N/A'}/10
Issues: ${c.issues || 'None'}
Focus: ${c.next_week_focus || 'N/A'}
`.trim()).join('\n---\n');

  const nextWeek = checkins.length > 0
    ? Math.max(...checkins.map(c => c.week_no)) + 1
    : 1;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: `You are a NASM-certified fitness program architect for FitnessByMaddy.

${clientProfile}

Recent check-ins:
${checkinSummary || 'No previous check-ins (Week 1)'}

Generate a Week ${nextWeek} program as JSON with this exact structure:
{
  "workout_plan": {
    "split": "push/pull/legs or upper/lower or full body",
    "days": [
      {
        "day": "Monday",
        "focus": "Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "cardio": { "type": "LISS/HIIT", "frequency": "3x/week", "duration": "20-30min" }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Meal 1", "time": "8:00 AM", "description": "..." }
    ],
    "hydration": "3-4L water daily",
    "supplements": ["whey protein", "creatine 5g", "multivitamin"]
  },
  "notes": "One-liner weekly context note for WhatsApp"
}

Rules:
- Be progressive: adjust based on check-in data
- Never prescribe below 1200 calories for anyone
- Never recommend banned substances
- Keep it practical and achievable
- If compliance was low, simplify the plan
- If energy was low, reduce volume slightly

Return ONLY valid JSON, no markdown.`
    }],
  });

  const text = response.content[0].text.trim();
  return JSON.parse(text);
}

async function generatePDF(client, weekNo, plan) {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const gold = rgb(0.72, 0.59, 0.35);
  const charcoal = rgb(0.17, 0.17, 0.17);
  const grey = rgb(0.42, 0.42, 0.42);

  // --- COVER PAGE ---
  let page = doc.addPage([595, 842]);
  page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: charcoal });
  page.drawText('FITNESS BY MADDY', {
    x: 50, y: 720, size: 14, font: helveticaBold, color: gold,
  });
  page.drawText(`WEEK ${weekNo}`, {
    x: 50, y: 660, size: 48, font: helveticaBold, color: rgb(1, 1, 1),
  });
  page.drawText('TRAINING & NUTRITION PLAN', {
    x: 50, y: 625, size: 14, font: helvetica, color: gold,
  });
  page.drawText(`Prepared for: ${client.name || 'Client'}`, {
    x: 50, y: 560, size: 12, font: helvetica, color: rgb(0.7, 0.7, 0.7),
  });
  page.drawText(`Program: ${client.program}`, {
    x: 50, y: 540, size: 12, font: helvetica, color: rgb(0.7, 0.7, 0.7),
  });

  // --- WORKOUT PAGE(S) ---
  const workout = plan.workout_plan;
  if (workout && workout.days) {
    page = doc.addPage([595, 842]);
    let y = 790;

    page.drawText('WORKOUT PLAN', {
      x: 50, y, size: 18, font: helveticaBold, color: charcoal,
    });
    y -= 10;
    page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 2, color: gold });
    y -= 25;

    if (workout.split) {
      page.drawText(`Split: ${workout.split}`, {
        x: 50, y, size: 11, font: helvetica, color: grey,
      });
      y -= 25;
    }

    for (const day of workout.days) {
      if (y < 100) {
        page = doc.addPage([595, 842]);
        y = 790;
      }

      page.drawText(`${day.day} — ${day.focus}`, {
        x: 50, y, size: 13, font: helveticaBold, color: charcoal,
      });
      y -= 18;

      for (const ex of (day.exercises || [])) {
        if (y < 60) {
          page = doc.addPage([595, 842]);
          y = 790;
        }
        const line = `  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`;
        page.drawText(line, {
          x: 60, y, size: 10, font: helvetica, color: grey,
        });
        y -= 15;
      }
      y -= 10;
    }

    if (workout.cardio) {
      if (y < 100) {
        page = doc.addPage([595, 842]);
        y = 790;
      }
      y -= 5;
      page.drawText('CARDIO', {
        x: 50, y, size: 13, font: helveticaBold, color: charcoal,
      });
      y -= 18;
      page.drawText(
        `${workout.cardio.type}  |  ${workout.cardio.frequency}  |  ${workout.cardio.duration}`,
        { x: 60, y, size: 10, font: helvetica, color: grey }
      );
    }
  }

  // --- NUTRITION PAGE ---
  const nutrition = plan.nutrition_plan;
  if (nutrition) {
    page = doc.addPage([595, 842]);
    let y = 790;

    page.drawText('NUTRITION PLAN', {
      x: 50, y, size: 18, font: helveticaBold, color: charcoal,
    });
    y -= 10;
    page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 2, color: gold });
    y -= 30;

    page.drawText(
      `Calories: ${nutrition.calories}  |  Protein: ${nutrition.protein_g}g  |  Carbs: ${nutrition.carbs_g}g  |  Fat: ${nutrition.fat_g}g`,
      { x: 50, y, size: 11, font: helveticaBold, color: charcoal }
    );
    y -= 30;

    for (const meal of (nutrition.meals || [])) {
      if (y < 80) {
        page = doc.addPage([595, 842]);
        y = 790;
      }
      page.drawText(`${meal.meal} (${meal.time})`, {
        x: 50, y, size: 12, font: helveticaBold, color: charcoal,
      });
      y -= 16;

      const desc = meal.description || '';
      const lines = desc.match(/.{1,80}/g) || [desc];
      for (const line of lines) {
        page.drawText(line, { x: 60, y, size: 10, font: helvetica, color: grey });
        y -= 14;
      }
      y -= 8;
    }

    if (nutrition.hydration) {
      y -= 5;
      page.drawText(`Hydration: ${nutrition.hydration}`, {
        x: 50, y, size: 10, font: helvetica, color: grey,
      });
      y -= 16;
    }

    if (nutrition.supplements && nutrition.supplements.length) {
      page.drawText(`Supplements: ${nutrition.supplements.join(', ')}`, {
        x: 50, y, size: 10, font: helvetica, color: grey,
      });
    }
  }

  return doc.save();
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const { client_id, week_no } = body;

    if (!client_id) return res.status(400).json({ error: 'client_id required' });

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'client not found' });

    const resolvedWeek = week_no || 1;

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const plan = await generateWithClaude(client, checkins || []);

    const planJson = JSON.stringify(plan);
    if (containsRiskyContent(planJson)) {
      await sendWhatsAppWithRateLimit(
        MADDY_PHONE,
        'escalation_alert',
        [maskPhone(client.phone), `Week ${resolvedWeek} program flagged for risky content — needs manual review`],
        'Maddy',
        true
      );
      return res.status(200).json({ ok: false, reason: 'flagged_for_review' });
    }

    const pdfBytes = await generatePDF(client, resolvedWeek, plan);
    const pdfPath = `${client.id}/week_${resolvedWeek}.pdf`;

    await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true,
      });

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { error: progErr } = await supabase.from('programs').insert({
      client_id,
      week_no: resolvedWeek,
      pdf_url: pdfUrl,
      workout_plan: plan.workout_plan,
      nutrition_plan: plan.nutrition_plan,
      notes: plan.notes || null,
    });

    if (progErr) throw progErr;

    await sendWhatsAppWithRateLimit(
      client.phone,
      'program_ready',
      [client.name || 'there', String(resolvedWeek), plan.notes || 'New week, new gains!'],
      client.name || 'there',
      true
    );

    return res.status(200).json({ ok: true, week: resolvedWeek, pdf_url: pdfUrl });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
