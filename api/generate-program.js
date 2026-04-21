const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getClient } = require('../lib/supabase');
const { sendText } = require('../lib/whatsapp');
const { needsEscalation, notifyMaddy } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'anabolic steroid',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

function checkSafety(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some((flag) => lower.includes(flag));
}

async function generatePDF(workout, nutrition, client, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, 595, 80).fill('#2C2C2C');
    doc.fontSize(24).fill('#B8965A').text('FITNESS BY MADDY', 50, 25, { align: 'left' });
    doc.fontSize(10).fill('#FFFFFF').text(`WEEK ${weekNo} PROGRAM`, 50, 55, { align: 'left' });
    doc.fontSize(10).fill('#FFFFFF').text(client.name || 'Client', 400, 25, { align: 'right' });
    doc.fontSize(8).fill('#C8B89A').text(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), 400, 40, { align: 'right' });

    let y = 100;

    doc.fontSize(16).fill('#B8965A').text('WORKOUT PLAN', 50, y);
    y += 30;

    if (workout && workout.days) {
      for (const day of workout.days) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(12).fill('#2C2C2C').text(day.name || 'Training Day', 50, y);
        y += 20;
        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 740) { doc.addPage(); y = 50; }
            doc.fontSize(9).fill('#6B6B6B').text(
              `  ${ex.name} — ${ex.sets}x${ex.reps}${ex.rest ? ` (rest: ${ex.rest})` : ''}`,
              60, y
            );
            y += 16;
          }
        }
        y += 10;
      }
    } else if (typeof workout === 'string') {
      doc.fontSize(10).fill('#2C2C2C').text(workout, 50, y, { width: 495 });
      y += doc.heightOfString(workout, { width: 495 }) + 20;
    }

    if (y > 600) { doc.addPage(); y = 50; }
    doc.fontSize(16).fill('#B8965A').text('NUTRITION PLAN', 50, y);
    y += 30;

    if (nutrition && nutrition.meals) {
      for (const meal of nutrition.meals) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(11).fill('#2C2C2C').text(meal.name || 'Meal', 50, y);
        y += 18;
        if (meal.items) {
          for (const item of meal.items) {
            if (y > 740) { doc.addPage(); y = 50; }
            doc.fontSize(9).fill('#6B6B6B').text(`  • ${item}`, 60, y);
            y += 14;
          }
        }
        y += 8;
      }
      if (nutrition.macros) {
        y += 10;
        doc.fontSize(10).fill('#2C2C2C').text(
          `Daily Macros: ${nutrition.macros.calories || '—'} kcal | P: ${nutrition.macros.protein || '—'}g | C: ${nutrition.macros.carbs || '—'}g | F: ${nutrition.macros.fat || '—'}g`,
          50, y
        );
      }
    } else if (typeof nutrition === 'string') {
      doc.fontSize(10).fill('#2C2C2C').text(nutrition, 50, y, { width: 495 });
    }

    const pageHeight = doc.page.height;
    doc.rect(0, pageHeight - 40, 595, 40).fill('#2C2C2C');
    doc.fontSize(8).fill('#C8B89A').text(
      'fitnessbymaddy.com | @fitnessbymaddy_',
      50, pageHeight - 28, { align: 'center', width: 495 }
    );

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getClient();

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

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    let intakeData = null;
    try {
      const { data: intakeFile } = await supabase.storage
        .from('clients')
        .download(`intake/${client.lead_id}.json`);
      if (intakeFile) {
        intakeData = JSON.parse(await intakeFile.text());
      }
    } catch (e) {
      // No intake data available
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy. You create weekly workout and nutrition plans tailored to individual clients.

RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend any banned or dangerous supplements
- Never promise specific weight loss timelines
- Always include warm-up and cool-down
- Adjust intensity based on compliance score and energy levels
- If client reports pain or injury, reduce load and suggest rest

OUTPUT FORMAT: Return valid JSON with this structure:
{
  "workout": {
    "days": [
      {
        "name": "Day 1 - Upper Body",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s" }
        ]
      }
    ],
    "notes": "Focus note for the week"
  },
  "nutrition": {
    "macros": { "calories": 2000, "protein": 150, "carbs": 200, "fat": 70 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "items": ["3 eggs scrambled", "2 toast wheat", "1 banana"] }
    ],
    "notes": "Hydration and supplement notes"
  },
  "coach_note": "Short motivational note for the client"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

Client: ${client.name || 'Client'}
Program: ${client.program}
${intakeData ? `Age: ${intakeData.age}, Gender: ${intakeData.gender}` : ''}
${intakeData ? `Goal: ${intakeData.goal}` : ''}
${intakeData ? `Experience: ${intakeData.experience_level}` : ''}
${intakeData ? `Injuries/Conditions: ${intakeData.injuries || 'None reported'}` : ''}
${intakeData ? `Diet preference: ${intakeData.diet_preference || 'No preference'}` : ''}
${intakeData ? `Schedule: ${intakeData.schedule || 'Flexible'}` : ''}

Recent check-in data:
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map((c) => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10${c.issues ? `, Issues: ${c.issues}` : ''}`).join('\n')
  : 'No check-in data yet (first week)'}

Return ONLY the JSON object, no markdown or extra text.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;

    if (checkSafety(content)) {
      await notifyMaddy(
        'Program flagged for safety review',
        { phone: client.phone, detail: `Week ${week_no} program contained risky content` },
        { whatsapp: { sendText }, supabase }
      );

      await supabase.from('programs').insert({
        client_id,
        week_no,
        notes: 'FLAGGED FOR REVIEW — awaiting Maddy approval',
        generated_at: new Date().toISOString(),
      });

      return res.status(200).json({ ok: true, flagged: true });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse Claude response as JSON');
      }
    }

    const pdfBuffer = await generatePDF(parsed.workout, parsed.nutrition, client, week_no);

    const pdfPath = `${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    let pdfUrl = null;
    if (!uploadError) {
      const { data: urlData } = supabase.storage.from('clients').getPublicUrl(pdfPath);
      pdfUrl = urlData.publicUrl;
    }

    await supabase.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: parsed.workout,
      nutrition_plan: parsed.nutrition,
      notes: parsed.coach_note || null,
    });

    const coachNote = parsed.coach_note || `Your Week ${week_no} program is ready!`;
    const msg = `${coachNote}\n\n📋 Your Week ${week_no} program is ready!\n${pdfUrl || 'PDF will be shared shortly.'}`;
    await sendText(client.phone, msg, { supabase });

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, pdfUrl });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
