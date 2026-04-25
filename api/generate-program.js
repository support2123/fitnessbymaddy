const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/mask-phone');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const UNSAFE_PATTERNS = [
  /under\s*800\s*cal/i, /500\s*cal/i, /extreme\s*cut/i,
  /clenbuterol/i, /dnp/i, /ephedra/i, /anabolic/i, /steroid/i,
  /lose\s*\d{2,}\s*kg\s*in\s*\d\s*week/i
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

    const sb = getSupabase();

    const { data: client } = await sb
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await sb
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await sb
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const prompt = buildPrompt(client, recentCheckins || [], lastProgram, week_no);

    const anthropic = new Anthropic();
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0].text;

    const safetyCheck = checkSafety(responseText);
    if (!safetyCheck.safe) {
      await sb.from('escalations').insert({
        phone: client.phone,
        reason: `Unsafe program content: ${safetyCheck.reason}`,
        context: `Client ${client_id}, Week ${week_no}`
      });
      return res.status(200).json({ ok: false, flagged: true, reason: safetyCheck.reason });
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const parsed = JSON.parse(extractJSON(responseText));
      workoutPlan = parsed.workout_plan || parsed.workout || {};
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition || {};
      notes = parsed.notes || parsed.coach_notes || '';
    } catch {
      workoutPlan = { raw: responseText };
      nutritionPlan = {};
      notes = '';
    }

    const pdfBuffer = await generatePDF(client, week_no, workoutPlan, nutritionPlan, notes);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await sb.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadErr) {
      console.error(`[generate-program] Upload error: ${uploadErr.message}`);
    }

    const { data: publicUrl } = sb.storage.from('clients').getPublicUrl(pdfPath);

    const { data: program, error: insertErr } = await sb.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: publicUrl?.publicUrl || pdfPath,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes
    }).select().single();

    if (insertErr) {
      console.error(`[generate-program] Insert error: ${insertErr.message}`);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const contextNote = notes
      ? `Week ${week_no} program ready! ${typeof notes === 'string' ? notes.slice(0, 100) : ''}`
      : `Week ${week_no} program is ready!`;

    await sendTemplate(client.phone, 'program_delivery', {
      name: client.name || 'there',
      templateParams: [client.name || 'there', String(week_no), contextNote]
    });

    await sb.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    console.log(`[generate-program] Week ${week_no} for ${maskPhone(client.phone)}`);
    return res.status(200).json({ ok: true, program_id: program.id });

  } catch (err) {
    console.error(`[generate-program] Error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, lastProgram, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues: ${c.issues || 'none'}`
  ).join('\n');

  const lastProgramSummary = lastProgram
    ? `Last program (Week ${lastProgram.week_no}): ${JSON.stringify(lastProgram.workout_plan || {}).slice(0, 500)}`
    : 'No previous program';

  return `You are a certified fitness program architect for FitnessByMaddy.
Generate a Week ${weekNo} training and nutrition program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

PREVIOUS PROGRAM:
${lastProgramSummary}

REQUIREMENTS:
- Create a 7-day workout plan (progressive overload from last week if available)
- Create a daily nutrition plan with macros
- Include warm-up and cooldown for each session
- Be specific: sets, reps, rest times, tempo
- Nutrition: calories, protein, carbs, fat for each meal
- Add a coach note about focus areas this week

OUTPUT FORMAT (JSON):
{
  "workout_plan": {
    "day_1": { "name": "...", "exercises": [{"name":"...", "sets":..., "reps":"...", "rest":"...", "tempo":"..."}], "warmup": "...", "cooldown": "..." },
    ...
  },
  "nutrition_plan": {
    "daily_calories": ...,
    "protein_g": ...,
    "carbs_g": ...,
    "fat_g": ...,
    "meals": [{"name":"...", "foods":"...", "calories":..., "protein":..., "carbs":..., "fat":...}]
  },
  "notes": "Coach note for the week..."
}

SAFETY: Never prescribe below 1200 calories for women or 1500 for men. No banned substances. No extreme protocols. If the client reports pain or medical issues, note that Maddy should review personally.`;
}

function checkSafety(text) {
  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, reason: `Matched unsafe pattern: ${pattern}` };
    }
  }
  return { safe: true };
}

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

function generatePDF(client, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(10).text('FITNESS BY MADDY', 50, 30, { characterSpacing: 4 });
    doc.fill('#FFFFFF').fontSize(28).text(`WEEK ${weekNo} PROGRAM`, 50, 55);
    doc.fill('#B8965A').fontSize(12).text(client.name || 'Client', 50, 92);

    doc.fill('#2C2C2C');
    let y = 140;

    if (notes) {
      doc.fontSize(10).fill('#6B6B6B').text(typeof notes === 'string' ? notes : JSON.stringify(notes), 50, y, { width: 500 });
      y += 40;
    }

    doc.fontSize(16).fill('#2C2C2C').text('WORKOUT PLAN', 50, y);
    y += 25;

    const days = workoutPlan && typeof workoutPlan === 'object' ? Object.entries(workoutPlan) : [];
    for (const [dayKey, dayPlan] of days) {
      if (dayKey === 'raw') {
        doc.fontSize(9).fill('#2C2C2C').text(String(dayPlan).slice(0, 2000), 50, y, { width: 500 });
        y += 200;
        continue;
      }

      if (y > 700) {
        doc.addPage();
        y = 50;
      }

      const dayName = (dayPlan && dayPlan.name) ? dayPlan.name : dayKey.replace(/_/g, ' ').toUpperCase();
      doc.fontSize(12).fill('#B8965A').text(dayName, 50, y);
      y += 18;

      const exercises = (dayPlan && dayPlan.exercises) || [];
      for (const ex of exercises) {
        if (y > 750) { doc.addPage(); y = 50; }
        const line = `${ex.name || '?'} — ${ex.sets || '?'}x${ex.reps || '?'} | Rest: ${ex.rest || '?'} | Tempo: ${ex.tempo || 'controlled'}`;
        doc.fontSize(9).fill('#2C2C2C').text(line, 70, y, { width: 480 });
        y += 14;
      }
      y += 10;
    }

    if (y > 650) { doc.addPage(); y = 50; }

    doc.fontSize(16).fill('#2C2C2C').text('NUTRITION PLAN', 50, y);
    y += 25;

    if (nutritionPlan) {
      const macroLine = `Daily: ${nutritionPlan.daily_calories || '?'} cal | Protein: ${nutritionPlan.protein_g || '?'}g | Carbs: ${nutritionPlan.carbs_g || '?'}g | Fat: ${nutritionPlan.fat_g || '?'}g`;
      doc.fontSize(10).fill('#2C2C2C').text(macroLine, 50, y, { width: 500 });
      y += 20;

      const meals = nutritionPlan.meals || [];
      for (const meal of meals) {
        if (y > 750) { doc.addPage(); y = 50; }
        doc.fontSize(10).fill('#B8965A').text(meal.name || 'Meal', 50, y);
        y += 14;
        doc.fontSize(9).fill('#6B6B6B').text(
          `${meal.foods || '?'} (${meal.calories || '?'} cal, P:${meal.protein || '?'}g, C:${meal.carbs || '?'}g, F:${meal.fat || '?'}g)`,
          70, y, { width: 480 }
        );
        y += 16;
      }
    }

    doc.rect(0, doc.page.height - 40, doc.page.width, 40).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(8).text(
      'FITNESS BY MADDY | fitnessbymaddy.com | @fitnessbymaddy_',
      50, doc.page.height - 28, { width: 500, align: 'center' }
    );

    doc.end();
  });
}
