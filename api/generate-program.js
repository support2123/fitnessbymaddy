const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const UNSAFE_PATTERNS = [
  /below\s*\d{3,4}\s*calorie/i,
  /starvation/i,
  /clenbuterol/i,
  /dnp/i,
  /anabolic\s*steroid/i,
  /ephedra/i,
  /lose\s*\d{2,}\s*kg.*week/i,
  /semaglutide/i,
  /ozempic/i
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .maybeSingle();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeMsg } = await db
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .eq('template_name', 'intake_form')
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let intakeData = {};
    if (intakeMsg?.body) {
      try { intakeData = JSON.parse(intakeMsg.body); } catch {}
    }

    const prompt = buildProgramPrompt(client, recentCheckins || [], intakeData, week_no);

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
    const rawOutput = claudeData.content?.[0]?.text || '';

    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(rawOutput)) {
        await db.from('escalations').insert({
          phone: client.phone,
          reason: 'unsafe_program_content',
          message_body: `Week ${week_no}: matched pattern ${pattern.toString()}`
        });
        return res.status(422).json({
          error: 'Program flagged for safety review',
          pattern: pattern.toString()
        });
      }
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const jsonMatch = rawOutput.match(/```json\s*([\s\S]*?)\s*```/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[1] : rawOutput);
      workoutPlan = parsed.workout_plan || parsed.workout || {};
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition || {};
      notes = parsed.notes || parsed.coach_notes || '';
    } catch {
      workoutPlan = { raw: rawOutput };
      nutritionPlan = {};
      notes = '';
    }

    const pdfBytes = await generatePDF(client, week_no, workoutPlan, nutritionPlan, notes);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('programs')
      .upload(filePath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) console.error('PDF upload error:', uploadErr.message);

    const { data: urlData } = db.storage
      .from('programs')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    const { error: insertErr } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes
    });

    if (insertErr) {
      console.error('Program insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      pdfUrl
    ]);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no));

    return res.json({ success: true, week_no, pdf_url: pdfUrl });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, checkins, intake, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are "Program Architect", an expert fitness coach creating Week ${weekNo} of a 12-week personalized program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: 12-Week Custom Training
- Started: ${client.program_started_at}
${intake.age ? `- Age: ${intake.age}` : ''}
${intake.gender ? `- Gender: ${intake.gender}` : ''}
${intake.goal ? `- Goal: ${intake.goal}` : ''}
${intake.injuries ? `- Injuries/Limitations: ${intake.injuries}` : ''}
${intake.diet_preference ? `- Diet Preference: ${intake.diet_preference}` : ''}
${intake.workout_experience ? `- Experience: ${intake.workout_experience}` : ''}
${intake.available_equipment ? `- Equipment: ${intake.available_equipment}` : ''}

${lastCheckin ? `LAST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None'}
- Focus: ${lastCheckin.next_week_focus || 'N/A'}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10` : ''}

RULES:
- Create a safe, science-backed program
- NEVER recommend extreme calorie restriction (below 1200 cal for women, 1500 for men)
- NEVER recommend any banned or prescription substances
- NEVER promise unrealistic results
- Progressive overload from previous weeks
- Adjust based on compliance and energy levels
- If energy is low (below 5), reduce volume slightly
- If compliance is low (below 5), simplify the plan

Return a JSON object with this structure:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "15 min incline walk"
      }
    ],
    "rest_days": ["Sunday"],
    "weekly_notes": ""
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "example": "4 eggs, 2 toast, fruit", "time": "8:00 AM" }
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3-4 liters water daily",
    "notes": ""
  },
  "notes": "Coach notes for this week"
}
\`\`\``;
}

async function generatePDF(client, weekNo, workout, nutrition, notes) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const gold = rgb(0.722, 0.588, 0.353);
  const charcoal = rgb(0.173, 0.173, 0.173);
  const white = rgb(1, 1, 1);
  const grey = rgb(0.42, 0.42, 0.42);

  let page = doc.addPage([595, 842]);
  const { width, height } = page.getSize();

  page.drawRectangle({ x: 0, y: height - 120, width, height: 120, color: charcoal });
  page.drawText('FITNESS BY MADDY', {
    x: 40, y: height - 50, size: 24, font: fontBold, color: gold
  });
  page.drawText(`Week ${weekNo} Program`, {
    x: 40, y: height - 80, size: 16, font, color: white
  });
  page.drawText(client.name || 'Client', {
    x: 40, y: height - 100, size: 12, font, color: rgb(0.7, 0.7, 0.7)
  });

  let y = height - 160;

  page.drawText('WORKOUT PLAN', { x: 40, y, size: 14, font: fontBold, color: gold });
  y -= 10;
  page.drawRectangle({ x: 40, y, width: width - 80, height: 1, color: gold });
  y -= 20;

  const days = workout.days || workout.raw ? [{ day: 'Program', exercises: [], notes: typeof workout.raw === 'string' ? workout.raw.slice(0, 500) : '' }] : [];

  for (const day of days) {
    if (y < 100) {
      page = doc.addPage([595, 842]);
      y = height - 60;
    }

    page.drawText(day.day || '', { x: 40, y, size: 12, font: fontBold, color: charcoal });
    if (day.focus) {
      page.drawText(` - ${day.focus}`, { x: 120, y, size: 10, font, color: grey });
    }
    y -= 18;

    const exercises = day.exercises || [];
    for (const ex of exercises) {
      if (y < 60) {
        page = doc.addPage([595, 842]);
        y = height - 60;
      }
      const line = `  ${ex.name || ''} — ${ex.sets || ''}x${ex.reps || ''} (${ex.rest || ''})`;
      page.drawText(line, { x: 50, y, size: 9, font, color: charcoal });
      y -= 14;
    }

    if (day.cardio) {
      page.drawText(`  Cardio: ${day.cardio}`, { x: 50, y, size: 9, font, color: grey });
      y -= 14;
    }
    y -= 10;
  }

  if (y < 200) {
    page = doc.addPage([595, 842]);
    y = height - 60;
  }

  y -= 10;
  page.drawText('NUTRITION PLAN', { x: 40, y, size: 14, font: fontBold, color: gold });
  y -= 10;
  page.drawRectangle({ x: 40, y, width: width - 80, height: 1, color: gold });
  y -= 20;

  if (nutrition.calories) {
    page.drawText(`Daily Targets: ${nutrition.calories} cal | ${nutrition.protein_g || '?'}g protein | ${nutrition.carbs_g || '?'}g carbs | ${nutrition.fat_g || '?'}g fat`, {
      x: 40, y, size: 10, font, color: charcoal
    });
    y -= 20;
  }

  const meals = nutrition.meals || [];
  for (const meal of meals) {
    if (y < 60) {
      page = doc.addPage([595, 842]);
      y = height - 60;
    }
    page.drawText(`${meal.meal || ''} (${meal.time || ''})`, { x: 40, y, size: 10, font: fontBold, color: charcoal });
    y -= 14;
    page.drawText(`  ${meal.example || ''}`, { x: 50, y, size: 9, font, color: grey });
    y -= 18;
  }

  if (notes) {
    y -= 10;
    page.drawText('COACH NOTES', { x: 40, y, size: 12, font: fontBold, color: gold });
    y -= 16;
    const noteLines = notes.match(/.{1,80}/g) || [];
    for (const line of noteLines.slice(0, 5)) {
      page.drawText(line, { x: 40, y, size: 9, font, color: charcoal });
      y -= 14;
    }
  }

  page.drawRectangle({ x: 0, y: 0, width, height: 40, color: charcoal });
  page.drawText('fitnessbymaddy.com', { x: 40, y: 14, size: 9, font, color: gold });
  page.drawText('Confidential - Do not share', {
    x: width - 180, y: 14, size: 8, font, color: rgb(0.5, 0.5, 0.5)
  });

  return doc.save();
}
