const { getSupabase } = require('../lib/supabase');
const { sendWhatsAppForced } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

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
      .select('*, leads!clients_lead_id_fkey(*)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await db
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const programData = await callClaudeForProgram(client, intake, recentCheckins, week_no);

    if (programData.flagged) {
      const { createEscalation } = require('../lib/escalation');
      await createEscalation(
        client.phone,
        'risky_program_content',
        `Week ${week_no} program flagged: ${programData.flagReason}`,
        client_id
      );
      return res.json({ success: false, reason: 'flagged_for_review' });
    }

    const pdfBytes = await generatePDF(client, programData, week_no);

    const fileName = `week_${week_no}.pdf`;
    const storagePath = `clients/${client_id}/${fileName}`;

    const { error: uploadErr } = await db.storage
      .from('programs')
      .upload(storagePath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: urlData } = db.storage
      .from('programs')
      .getPublicUrl(storagePath);

    const pdfUrl = urlData?.publicUrl || storagePath;

    await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: programData.workout,
      nutrition_plan: programData.nutrition,
      notes: programData.notes,
    });

    const hinglish = isHinglish(client.leads?.market || 'GLOBAL');
    const msg = hinglish
      ? `Week ${week_no} ka program ready hai! PDF check karo. Focus: ${programData.notes || 'consistency and progress'}`
      : `Your Week ${week_no} program is ready! Check the PDF. Focus: ${programData.notes || 'consistency and progress'}`;

    await sendWhatsAppForced(client.phone, msg, null);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function callClaudeForProgram(client, intake, recentCheckins, weekNo) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return fallbackProgram(weekNo);
  }

  const checkinSummary = (recentCheckins || []).map((c) =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  const prompt = `You are a program architect for FitnessByMaddy, an elite online coaching brand.

Generate a Week ${weekNo} training and nutrition plan for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${intake?.age || 'unknown'}
- Gender: ${intake?.gender || 'unknown'}
- Height: ${intake?.height_cm || 'unknown'}cm
- Weight: ${intake?.weight_kg || 'unknown'}kg
- Goal: ${intake?.goal || 'general fitness'}
- Injuries: ${intake?.injuries || 'none'}
- Diet preference: ${intake?.diet_preference || 'no restriction'}
- Gym access: ${intake?.gym_access ? 'yes' : 'no'}
- Training days/week: ${intake?.workout_days_per_week || 5}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins (Week 1)'}

RULES:
- Never prescribe extreme calorie deficits (below 1200 for women, 1500 for men)
- Never recommend banned substances or unproven supplements
- Never set unrealistic timelines
- If you cannot safely prescribe for this client (injury, condition), set "flagged": true
- Be specific with exercises, sets, reps, rest times
- Include warm-up and cool-down

Return ONLY valid JSON:
{
  "workout": { "days": [...], "notes": "..." },
  "nutrition": { "calories": N, "protein_g": N, "carbs_g": N, "fat_g": N, "meals": [...], "notes": "..." },
  "notes": "one-liner focus for this week",
  "flagged": false,
  "flagReason": null
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const result = await response.json();
  const text = result.content?.[0]?.text || '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallbackProgram(weekNo);
    return JSON.parse(jsonMatch[0]);
  } catch {
    return fallbackProgram(weekNo);
  }
}

function fallbackProgram(weekNo) {
  return {
    workout: {
      days: [
        { day: 'Monday', focus: 'Upper Body Push', exercises: ['Bench Press 4x8', 'OHP 3x10', 'Lateral Raises 3x15', 'Tricep Pushdowns 3x12'] },
        { day: 'Tuesday', focus: 'Lower Body', exercises: ['Squats 4x8', 'RDL 3x10', 'Leg Press 3x12', 'Calf Raises 4x15'] },
        { day: 'Wednesday', focus: 'Rest / Active Recovery', exercises: ['20min walk', 'Stretching'] },
        { day: 'Thursday', focus: 'Upper Body Pull', exercises: ['Barbell Rows 4x8', 'Pull-ups 3xAMRAP', 'Face Pulls 3x15', 'Bicep Curls 3x12'] },
        { day: 'Friday', focus: 'Lower Body + Core', exercises: ['Deadlifts 4x6', 'Bulgarian Split Squats 3x10', 'Leg Curls 3x12', 'Planks 3x45s'] },
        { day: 'Saturday', focus: 'Cardio + Abs', exercises: ['30min LISS', 'Ab circuit 3 rounds'] },
        { day: 'Sunday', focus: 'Full Rest', exercises: [] },
      ],
      notes: 'Progressive overload - aim to increase weight or reps each week.',
    },
    nutrition: {
      calories: 2000,
      protein_g: 150,
      carbs_g: 200,
      fat_g: 67,
      meals: [
        { meal: 'Breakfast', example: 'Oats + protein + banana' },
        { meal: 'Lunch', example: 'Chicken/paneer + rice + vegetables' },
        { meal: 'Snack', example: 'Greek yogurt + nuts' },
        { meal: 'Dinner', example: 'Fish/tofu + sweet potato + salad' },
      ],
      notes: 'Drink 3L water daily. Eat protein with every meal.',
    },
    notes: `Week ${weekNo}: Build consistency and track all meals.`,
    flagged: false,
    flagReason: null,
  };
}

async function generatePDF(client, programData, weekNo) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  const black = rgb(0.17, 0.17, 0.17);
  const gold = rgb(0.72, 0.59, 0.35);
  const grey = rgb(0.42, 0.42, 0.42);

  const page1 = doc.addPage([595, 842]);
  const { width, height } = page1.getSize();

  page1.drawRectangle({ x: 0, y: height - 100, width, height: 100, color: black });
  page1.drawText('FITNESS BY MADDY', { x: 40, y: height - 50, size: 24, font, color: gold });
  page1.drawText(`Week ${weekNo} Program`, { x: 40, y: height - 75, size: 14, font: bodyFont, color: rgb(1, 1, 1) });
  page1.drawText(`Client: ${client.name || 'Client'}`, { x: 40, y: height - 92, size: 10, font: bodyFont, color: rgb(0.7, 0.7, 0.7) });

  let y = height - 140;
  page1.drawText('WORKOUT PLAN', { x: 40, y, size: 16, font, color: black });
  y -= 8;
  page1.drawRectangle({ x: 40, y, width: width - 80, height: 2, color: gold });
  y -= 20;

  const days = programData.workout?.days || [];
  for (const day of days) {
    if (y < 80) {
      const newPage = doc.addPage([595, 842]);
      y = newPage.getSize().height - 60;
    }
    page1.drawText(`${day.day} — ${day.focus}`, { x: 40, y, size: 11, font, color: black });
    y -= 16;
    const exercises = day.exercises || [];
    for (const ex of exercises) {
      if (y < 60) break;
      page1.drawText(`  ${ex}`, { x: 52, y, size: 9, font: bodyFont, color: grey });
      y -= 14;
    }
    y -= 8;
  }

  const page2 = doc.addPage([595, 842]);
  let y2 = page2.getSize().height - 60;

  page2.drawText('NUTRITION PLAN', { x: 40, y: y2, size: 16, font, color: black });
  y2 -= 8;
  page2.drawRectangle({ x: 40, y: y2, width: width - 80, height: 2, color: gold });
  y2 -= 25;

  const nutrition = programData.nutrition || {};
  page2.drawText(`Daily Targets: ${nutrition.calories || '—'} kcal | Protein: ${nutrition.protein_g || '—'}g | Carbs: ${nutrition.carbs_g || '—'}g | Fat: ${nutrition.fat_g || '—'}g`, {
    x: 40, y: y2, size: 10, font: bodyFont, color: black,
  });
  y2 -= 30;

  const meals = nutrition.meals || [];
  for (const meal of meals) {
    page2.drawText(`${meal.meal}:`, { x: 40, y: y2, size: 11, font, color: black });
    y2 -= 16;
    page2.drawText(`  ${meal.example}`, { x: 52, y: y2, size: 9, font: bodyFont, color: grey });
    y2 -= 22;
  }

  y2 -= 20;
  page2.drawText('WEEKLY FOCUS', { x: 40, y: y2, size: 12, font, color: gold });
  y2 -= 18;
  page2.drawText(programData.notes || 'Stay consistent and trust the process.', {
    x: 40, y: y2, size: 10, font: bodyFont, color: black,
  });

  return doc.save();
}
