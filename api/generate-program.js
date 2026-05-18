const { getSupabase } = require('../lib/supabase');
const { sendDocument } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
const Anthropic = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  try {
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

    const { data: intakeData } = await db
      .from('clients')
      .select('intake_data')
      .eq('id', client_id)
      .single();

    const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(client, recentCheckins || [], intakeData?.intake_data, week_no);

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const programText = response.content[0].text;

    const safetyCheck = checkProgramSafety(programText);
    if (!safetyCheck.safe) {
      const { notifyMaddy } = require('../lib/escalation');
      await notifyMaddy(
        client.phone,
        `Program safety flag (Week ${week_no}): ${safetyCheck.reason}`,
        programText.slice(0, 200)
      );
      return res.status(200).json({
        success: false,
        flagged: true,
        reason: safetyCheck.reason
      });
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const parsed = JSON.parse(programText);
      workoutPlan = parsed.workout_plan;
      nutritionPlan = parsed.nutrition_plan;
      notes = parsed.notes;
    } catch {
      workoutPlan = { raw: programText };
      nutritionPlan = {};
      notes = '';
    }

    const pdfHtml = renderProgramPdf(client, week_no, workoutPlan, nutritionPlan, notes);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');

    const filePath = `clients/${client_id}/week_${week_no}.html`;
    await db.storage.from('programs').upload(filePath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true
    });

    const { data: urlData } = db.storage.from('programs').getPublicUrl(filePath);
    const pdfUrl = urlData?.publicUrl || filePath;

    await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes: notes || null
    });

    const contextNote = buildContextNote(recentCheckins, week_no, isHinglish(client.market));
    await sendDocument(client.phone, pdfUrl, contextNote);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', parseInt(week_no));

    return res.status(200).json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

function buildSystemPrompt() {
  return `You are a NASM-certified fitness program architect working for Fitness by Maddy,
an elite online coaching brand. You create weekly customized workout and nutrition plans.

RULES:
- Never prescribe extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned or unregulated supplements
- Never promise specific weight loss timelines
- Respect any injuries or medical conditions mentioned
- Progressive overload is key — build on previous weeks
- Plans should be practical and sustainable

OUTPUT FORMAT: Return valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]}
    ],
    "cardio": { "frequency": "3x/week", "type": "LISS + 1 HIIT", "duration": "20-30min" }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fats_g": 70,
    "meal_timing": ["Pre-workout: ...", "Post-workout: ..."],
    "sample_meals": ["Meal 1: ...", "Meal 2: ..."],
    "hydration": "3-4L water daily"
  },
  "notes": "One-liner coach note for the client"
}`;
}

function buildUserPrompt(client, checkins, intake, weekNo) {
  let prompt = `Generate Week ${weekNo} program for client:\n`;
  prompt += `Name: ${client.name}\n`;
  prompt += `Program: ${client.program}\n`;

  if (intake) {
    prompt += `\nIntake Data:\n`;
    if (intake.goal) prompt += `Goal: ${intake.goal}\n`;
    if (intake.injuries) prompt += `Injuries/Conditions: ${intake.injuries}\n`;
    if (intake.experience_level) prompt += `Experience: ${intake.experience_level}\n`;
    if (intake.diet_preference) prompt += `Diet Preference: ${intake.diet_preference}\n`;
    if (intake.current_weight) prompt += `Current Weight: ${intake.current_weight}\n`;
    if (intake.target_weight) prompt += `Target Weight: ${intake.target_weight}\n`;
    if (intake.schedule) prompt += `Available Schedule: ${intake.schedule}\n`;
    if (intake.age) prompt += `Age: ${intake.age}\n`;
    if (intake.gender) prompt += `Gender: ${intake.gender}\n`;
  }

  if (checkins.length > 0) {
    prompt += `\nRecent Check-ins:\n`;
    for (const c of checkins) {
      prompt += `Week ${c.week_no}: Weight=${c.weight || 'N/A'}, `;
      prompt += `Waist=${c.waist || 'N/A'}, Compliance=${c.compliance_score}/10, `;
      prompt += `Energy=${c.energy}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      prompt += `\n`;
    }
  }

  prompt += `\nAdjust the program based on the client's progress. Return JSON only.`;
  return prompt;
}

function checkProgramSafety(programText) {
  const lower = programText.toLowerCase();
  const flags = [];

  const calorieMatch = lower.match(/"calories"\s*:\s*(\d+)/);
  if (calorieMatch && parseInt(calorieMatch[1]) < 1100) {
    flags.push('Dangerously low calories: ' + calorieMatch[1]);
  }

  const bannedTerms = ['clenbuterol', 'dnp', 'ephedrine', 'sarms', 'steroids', 'hgh'];
  for (const term of bannedTerms) {
    if (lower.includes(term)) flags.push(`Banned substance mentioned: ${term}`);
  }

  if (/lose\s+\d{2,}\s*(kg|lbs|pounds)\s+in\s+\d\s+week/.test(lower)) {
    flags.push('Unrealistic weight loss timeline');
  }

  return flags.length > 0
    ? { safe: false, reason: flags.join('; ') }
    : { safe: true };
}

function renderProgramPdf(client, weekNo, workout, nutrition, notes) {
  const days = workout?.days || [];
  const cardio = workout?.cardio || {};

  let workoutHtml = '';
  for (const day of days) {
    workoutHtml += `<div class="day-block">
      <h3>${day.day} — ${day.focus || ''}</h3>
      <table><tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th><th>Notes</th></tr>`;
    for (const ex of (day.exercises || [])) {
      workoutHtml += `<tr>
        <td>${ex.name}</td><td>${ex.sets}</td><td>${ex.reps}</td>
        <td>${ex.rest || ''}</td><td>${ex.notes || ''}</td>
      </tr>`;
    }
    workoutHtml += `</table></div>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #fff; padding: 40px; }
.header { text-align: center; padding: 40px 0; border-bottom: 2px solid #B8965A; margin-bottom: 40px; }
.header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #B8965A; letter-spacing: 4px; }
.header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #fff; letter-spacing: 2px; margin-top: 8px; }
.header p { color: #888; font-size: 14px; margin-top: 8px; }
.section-title { font-family: 'Bebas Neue', sans-serif; font-size: 24px; color: #B8965A; letter-spacing: 2px; margin: 32px 0 16px; padding-bottom: 8px; border-bottom: 1px solid #333; }
.day-block { margin-bottom: 24px; }
.day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 20px; color: #D4AF7A; margin-bottom: 8px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
th { background: #2a2a2a; color: #B8965A; text-align: left; padding: 8px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
td { padding: 8px 12px; border-bottom: 1px solid #2a2a2a; font-size: 14px; color: #ccc; }
.nutrition-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 16px 0; }
.macro-card { background: #2a2a2a; padding: 20px; text-align: center; border-radius: 4px; }
.macro-card .value { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #B8965A; }
.macro-card .label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
.meals { list-style: none; }
.meals li { padding: 8px 0; border-bottom: 1px solid #2a2a2a; font-size: 14px; color: #ccc; }
.meals li::before { content: "→ "; color: #B8965A; }
.coach-note { background: #2a2a2a; border-left: 3px solid #B8965A; padding: 16px 20px; margin-top: 32px; font-style: italic; color: #ccc; }
.footer { text-align: center; margin-top: 48px; padding-top: 24px; border-top: 1px solid #333; color: #555; font-size: 12px; }
</style>
</head>
<body>
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <h2>WEEK ${weekNo} PROGRAM</h2>
    <p>${client.name} — ${client.program?.toUpperCase() || 'CUSTOM'}</p>
  </div>

  <div class="section-title">WORKOUT PLAN</div>
  ${workoutHtml}
  ${cardio.type ? `<p style="color:#888; margin-top:8px;">Cardio: ${cardio.frequency || ''} — ${cardio.type} (${cardio.duration || ''})</p>` : ''}

  <div class="section-title">NUTRITION PLAN</div>
  <div class="nutrition-grid">
    <div class="macro-card"><div class="value">${nutrition?.calories || '—'}</div><div class="label">Calories</div></div>
    <div class="macro-card"><div class="value">${nutrition?.protein_g || '—'}g</div><div class="label">Protein</div></div>
    <div class="macro-card"><div class="value">${nutrition?.carbs_g || '—'}g</div><div class="label">Carbs</div></div>
    <div class="macro-card"><div class="value">${nutrition?.fats_g || '—'}g</div><div class="label">Fats</div></div>
  </div>
  ${nutrition?.hydration ? `<p style="color:#888; margin-top:8px;">Hydration: ${nutrition.hydration}</p>` : ''}
  ${nutrition?.sample_meals ? `<ul class="meals">${nutrition.sample_meals.map(m => `<li>${m}</li>`).join('')}</ul>` : ''}

  ${notes ? `<div class="coach-note">"${notes}" — Maddy</div>` : ''}

  <div class="footer">
    FITNESS BY MADDY &bull; fitnessbymaddy.com &bull; @fitnessbymaddy_
  </div>
</body>
</html>`;
}

function buildContextNote(checkins, weekNo, hinglish) {
  if (!checkins || checkins.length === 0) {
    return hinglish
      ? `Week ${weekNo} ka program ready hai! Let's crush it 💪`
      : `Your Week ${weekNo} program is ready! Let's crush it 💪`;
  }

  const latest = checkins[0];
  if (latest.compliance_score >= 8) {
    return hinglish
      ? `Bahut accha Week ${weekNo - 1}! Week ${weekNo} mein aur push karenge 🔥`
      : `Great Week ${weekNo - 1}! Pushing harder in Week ${weekNo} 🔥`;
  }

  return hinglish
    ? `Week ${weekNo} ka updated program. Focus rakhna, results aayenge! 💪`
    : `Week ${weekNo} program updated for you. Stay focused, results are coming! 💪`;
}
