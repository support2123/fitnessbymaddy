const { getSupabase } = require('../lib/supabase');
const { sendText, notifyMaddy } = require('../lib/whatsapp');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'extreme fast',
  'clenbuterol', 'dnp', 'ephedra', 'sarm', 'steroid',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*, leads(*)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    let intakeData = {};
    try {
      if (client.leads?.first_msg) intakeData = JSON.parse(client.leads.first_msg);
    } catch (e) { /* not JSON, ignore */ }

    const prompt = buildPrompt(client, intakeData, recentCheckins || [], week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content?.[0]?.text || '';

    const lowerResponse = responseText.toLowerCase();
    const flagged = SAFETY_FLAGS.some((f) => lowerResponse.includes(f));
    if (flagged) {
      await notifyMaddy(
        'Program flagged for review',
        `Client: ${client.name} (Week ${week_no})\nReason: Safety keyword detected in generated program`
      );
      return res.json({ success: false, reason: 'flagged_for_review' });
    }

    let workoutPlan, nutritionPlan;
    try {
      const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        workoutPlan = parsed.workout_plan || parsed.workout;
        nutritionPlan = parsed.nutrition_plan || parsed.nutrition;
      } else {
        workoutPlan = { raw: responseText };
        nutritionPlan = {};
      }
    } catch (e) {
      workoutPlan = { raw: responseText };
      nutritionPlan = {};
    }

    const pdfBuffer = await generatePDF(client, week_no, workoutPlan, nutritionPlan);

    const fileName = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    let pdfUrl = null;
    if (!uploadError) {
      const { data: urlData } = db.storage.from('programs').getPublicUrl(fileName);
      pdfUrl = urlData?.publicUrl;
    }

    await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes: `Generated for ${client.name}`,
    });

    if (pdfUrl) {
      const contextNote = `Week ${week_no} program ready! Focus: ${
        nutritionPlan?.focus || workoutPlan?.focus || 'progressive overload'
      }`;
      await sendText(client.phone, `${contextNote}\n\nDownload: ${pdfUrl}`);

      await db.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('client_id', client_id)
        .eq('week_no', week_no);
    }

    return res.json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const checkinSummary = checkins.map((c) =>
    `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues=${c.issues || 'none'}`
  ).join('\n');

  return `You are a certified fitness program architect for FitnessByMaddy.
Create a detailed Week ${weekNo} program for this client.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Goal: ${intake.goal || 'general fitness'}
- Experience: ${intake.experience_level || 'intermediate'}
- Injuries/limitations: ${intake.injuries || 'none'}
- Diet preference: ${intake.diet_preference || 'flexible'}
- Schedule: ${intake.schedule || '5 days/week'}

RECENT CHECK-IN DATA:
${checkinSummary || 'No prior check-ins (Week 1)'}

RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- No banned substances or supplements
- Realistic, evidence-based progressions only
- If client reports pain/injury, scale back that movement pattern
- Include warm-up and cool-down
- Provide exercise alternatives for home/travel

Return your response as JSON inside a code block:
\`\`\`json
{
  "workout_plan": {
    "focus": "brief focus description",
    "days": [
      {
        "day": "Day 1 - Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min incline walk + arm circles",
        "cooldown": "5 min stretch"
      }
    ]
  },
  "nutrition_plan": {
    "focus": "brief nutrition focus",
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "example": "Oats + protein + banana", "macros": "P30 C50 F10" }
    ],
    "notes": "Any special notes"
  }
}
\`\`\``;
}

function generatePDF(client, weekNo, workout, nutrition) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, 595, 842).fill('#1a1a1a');

    doc.fillColor('#B8965A')
      .fontSize(12)
      .text('FITNESS BY MADDY', 50, 40, { characterSpacing: 4 });

    doc.fillColor('#ffffff')
      .fontSize(36)
      .text(`WEEK ${weekNo}`, 50, 80);

    doc.fillColor('#B8965A')
      .fontSize(14)
      .text(`${client.name} — ${(client.program || '').toUpperCase()}`, 50, 125);

    doc.moveTo(50, 155).lineTo(545, 155).strokeColor('#B8965A').lineWidth(0.5).stroke();

    let y = 175;

    doc.fillColor('#B8965A').fontSize(16).text('WORKOUT PLAN', 50, y);
    y += 30;

    const days = workout?.days || [];
    for (const day of days) {
      if (y > 720) { doc.addPage(); doc.rect(0, 0, 595, 842).fill('#1a1a1a'); y = 50; }

      doc.fillColor('#ffffff').fontSize(13).text(day.day || '', 50, y);
      y += 20;

      if (day.warmup) {
        doc.fillColor('#999999').fontSize(9).text(`Warm-up: ${day.warmup}`, 60, y);
        y += 14;
      }

      const exercises = day.exercises || [];
      for (const ex of exercises) {
        if (y > 750) { doc.addPage(); doc.rect(0, 0, 595, 842).fill('#1a1a1a'); y = 50; }
        doc.fillColor('#D4AF7A').fontSize(10)
          .text(`${ex.name}  —  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}`, 60, y);
        y += 15;
        if (ex.notes) {
          doc.fillColor('#888888').fontSize(8).text(ex.notes, 70, y);
          y += 12;
        }
      }
      y += 10;
    }

    if (y > 600) { doc.addPage(); doc.rect(0, 0, 595, 842).fill('#1a1a1a'); y = 50; }

    doc.fillColor('#B8965A').fontSize(16).text('NUTRITION PLAN', 50, y);
    y += 30;

    if (nutrition?.calories) {
      doc.fillColor('#ffffff').fontSize(11)
        .text(`Daily Target: ${nutrition.calories} cal  |  P: ${nutrition.protein_g}g  C: ${nutrition.carbs_g}g  F: ${nutrition.fat_g}g`, 50, y);
      y += 25;
    }

    const meals = nutrition?.meals || [];
    for (const meal of meals) {
      if (y > 750) { doc.addPage(); doc.rect(0, 0, 595, 842).fill('#1a1a1a'); y = 50; }
      doc.fillColor('#D4AF7A').fontSize(10).text(`${meal.meal}: ${meal.example}`, 60, y);
      y += 14;
      if (meal.macros) {
        doc.fillColor('#888888').fontSize(8).text(meal.macros, 70, y);
        y += 12;
      }
    }

    y += 20;
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#333333').lineWidth(0.5).stroke();
    y += 15;
    doc.fillColor('#666666').fontSize(8)
      .text('Generated by FitnessByMaddy coaching system. For personal use only.', 50, y);

    doc.end();
  });
}
