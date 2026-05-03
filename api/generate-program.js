const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/mask');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'under 1000 calories', 'below 1000 calories', 'very low calorie',
  'clenbuterol', 'dnp', 'ephedrine', 'steroids', 'anabolic',
  'sarms', 'hgh', 'growth hormone', 'testosterone inject',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'extreme fasting', 'water fast', '0 calorie'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*, lead:leads(*)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await db
      .from('intakes')
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

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .eq('week_no', week_no - 1)
      .single();

    const prompt = buildPrompt({ client, intake, recentCheckins, prevProgram, weekNo: week_no });

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    const safetyIssue = checkSafety(content);
    if (safetyIssue) {
      const { escalate } = require('./lib/escalation');
      await escalate({
        phone: client.phone,
        reason: `Program safety flag: ${safetyIssue}`,
        messageBody: `Week ${week_no} program for ${maskPhone(client.phone)} flagged: ${safetyIssue}`
      });
      return res.json({ ok: false, flagged: true, reason: safetyIssue });
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const parsed = JSON.parse(extractJSON(content));
      workoutPlan = parsed.workout_plan || parsed.workouts || {};
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition || {};
      notes = parsed.notes || parsed.coach_notes || '';
    } catch {
      workoutPlan = { raw: content };
      nutritionPlan = {};
      notes = 'Auto-parse failed — raw output stored';
    }

    const pdfHtml = renderProgramPDF({ client, weekNo: week_no, workoutPlan, nutritionPlan, notes });

    const pdfPath = `clients/${client_id}/week_${week_no}.html`;
    await db.storage.from('client-files').upload(pdfPath, pdfHtml, {
      contentType: 'text/html',
      upsert: true
    });

    const { data: urlData } = db.storage.from('client-files').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { data: program, error } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes
    }).select().single();

    if (error) throw error;

    await sendWhatsApp({
      phone: client.phone,
      body: `Your Week ${week_no} program is ready! 🔥\n\n${notes ? notes.slice(0, 200) : 'Check your updated workout and nutrition plan.'}\n\nView: ${pdfUrl}`
    });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);
    return res.json({ ok: true, programId: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};

function buildPrompt({ client, intake, recentCheckins, prevProgram, weekNo }) {
  const checkinSummary = (recentCheckins || []).map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  const intakeInfo = intake
    ? `Age: ${intake.age}, Gender: ${intake.gender}, Goal: ${intake.goal}, Injuries: ${intake.injuries || 'none'}, Diet: ${intake.diet_preference || 'no preference'}, Days/week: ${intake.workout_days_per_week || 5}, Equipment: ${intake.equipment_access || 'full gym'}, Activity: ${intake.current_activity || 'unknown'}`
    : 'No intake form on file';

  const prevPlanNote = prevProgram
    ? `Previous week plan summary: ${JSON.stringify(prevProgram.workout_plan).slice(0, 500)}`
    : 'No previous program (first week)';

  return `You are a certified fitness program architect for Fitness by Maddy, an elite online coaching brand. Generate a Week ${weekNo} program for this client.

CLIENT PROFILE:
Name: ${client.name || 'Client'}
Program: ${client.program}
Started: ${client.program_started_at}
${intakeInfo}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

${prevPlanNote}

REQUIREMENTS:
- Generate a structured 7-day workout plan with exercises, sets, reps, rest periods
- Generate a daily nutrition plan with meals, portions, macros
- Include a short coach note (2-3 sentences) about focus for this week
- Progressive overload from previous week where applicable
- Account for any reported issues or injuries
- Moderate, safe calorie targets (never below 1200 for women, 1500 for men)
- No banned substances, no extreme protocols
- Be specific: exercise names, exact sets/reps, meal details

OUTPUT FORMAT (JSON only):
{
  "workout_plan": {
    "day_1": { "name": "...", "exercises": [{"name": "...", "sets": 3, "reps": "10-12", "rest": "60s", "notes": "..."}] },
    ...
  },
  "nutrition_plan": {
    "daily_calories": ...,
    "protein_g": ...,
    "carbs_g": ...,
    "fat_g": ...,
    "meals": [{"name": "Meal 1", "time": "7:00 AM", "items": ["..."], "macros": "..."}]
  },
  "notes": "Coach note for the week..."
}`;
}

function checkSafety(content) {
  const lower = content.toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }
  return null;
}

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

function renderProgramPDF({ client, weekNo, workoutPlan, nutritionPlan, notes }) {
  const workoutHtml = renderWorkout(workoutPlan);
  const nutritionHtml = renderNutrition(nutritionPlan);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #fff; padding: 40px 24px; }
.header { text-align: center; margin-bottom: 48px; padding-bottom: 24px; border-bottom: 2px solid #B8965A; }
.brand { font-family: 'Bebas Neue', sans-serif; font-size: 14px; letter-spacing: 6px; color: #B8965A; text-transform: uppercase; margin-bottom: 8px; }
h1 { font-family: 'Bebas Neue', sans-serif; font-size: 42px; letter-spacing: 2px; color: #fff; }
.subtitle { font-size: 14px; color: rgba(255,255,255,0.5); margin-top: 8px; }
.coach-note { background: rgba(184,150,90,0.1); border-left: 3px solid #B8965A; padding: 20px 24px; margin-bottom: 40px; font-size: 15px; line-height: 1.7; color: rgba(255,255,255,0.8); }
h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; letter-spacing: 2px; color: #B8965A; margin: 32px 0 16px; }
h3 { font-family: 'Bebas Neue', sans-serif; font-size: 20px; letter-spacing: 1px; color: #fff; margin: 24px 0 12px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
th { text-align: left; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #B8965A; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.15); }
td { padding: 10px 12px; font-size: 14px; color: rgba(255,255,255,0.8); border-bottom: 1px solid rgba(255,255,255,0.05); }
.macros { display: flex; gap: 24px; margin: 16px 0 24px; }
.macro-box { background: rgba(255,255,255,0.05); padding: 16px 20px; border-radius: 4px; text-align: center; flex: 1; }
.macro-num { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; }
.macro-label { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: rgba(255,255,255,0.5); margin-top: 4px; }
.meal { background: rgba(255,255,255,0.03); padding: 16px; margin-bottom: 12px; border-radius: 4px; }
.meal-name { font-weight: 600; color: #B8965A; margin-bottom: 6px; }
.meal-items { font-size: 14px; color: rgba(255,255,255,0.7); line-height: 1.6; }
.footer { text-align: center; margin-top: 48px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 12px; color: rgba(255,255,255,0.3); }
@media print { body { background: #1a1a1a; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<div class="header">
  <div class="brand">Fitness by Maddy</div>
  <h1>Week ${weekNo} Program</h1>
  <div class="subtitle">${client.name || 'Client'} · ${formatProgram(client.program)}</div>
</div>
${notes ? `<div class="coach-note">${notes}</div>` : ''}
<h2>Workout Plan</h2>
${workoutHtml}
<h2>Nutrition Plan</h2>
${nutritionHtml}
<div class="footer">Fitness by Maddy · fitnessbymaddy.com · Generated ${new Date().toLocaleDateString()}</div>
</body>
</html>`;
}

function renderWorkout(plan) {
  if (!plan || typeof plan !== 'object') return '<p>Plan details not available.</p>';
  if (plan.raw) return `<pre style="white-space:pre-wrap;color:rgba(255,255,255,0.8)">${escapeHtml(plan.raw)}</pre>`;

  let html = '';
  for (const [day, data] of Object.entries(plan)) {
    const label = data.name || day.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    html += `<h3>${label}</h3>`;
    if (Array.isArray(data.exercises)) {
      html += '<table><tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th><th>Notes</th></tr>';
      for (const ex of data.exercises) {
        html += `<tr><td>${escapeHtml(ex.name || '')}</td><td>${ex.sets || ''}</td><td>${escapeHtml(String(ex.reps || ''))}</td><td>${escapeHtml(ex.rest || '')}</td><td>${escapeHtml(ex.notes || '')}</td></tr>`;
      }
      html += '</table>';
    }
  }
  return html || '<p>Workout details loading...</p>';
}

function renderNutrition(plan) {
  if (!plan || typeof plan !== 'object') return '<p>Nutrition details not available.</p>';

  let html = '';
  if (plan.daily_calories || plan.protein_g) {
    html += '<div class="macros">';
    if (plan.daily_calories) html += `<div class="macro-box"><div class="macro-num">${plan.daily_calories}</div><div class="macro-label">Calories</div></div>`;
    if (plan.protein_g) html += `<div class="macro-box"><div class="macro-num">${plan.protein_g}g</div><div class="macro-label">Protein</div></div>`;
    if (plan.carbs_g) html += `<div class="macro-box"><div class="macro-num">${plan.carbs_g}g</div><div class="macro-label">Carbs</div></div>`;
    if (plan.fat_g) html += `<div class="macro-box"><div class="macro-num">${plan.fat_g}g</div><div class="macro-label">Fat</div></div>`;
    html += '</div>';
  }
  if (Array.isArray(plan.meals)) {
    for (const meal of plan.meals) {
      html += `<div class="meal"><div class="meal-name">${escapeHtml(meal.name || 'Meal')}${meal.time ? ' · ' + escapeHtml(meal.time) : ''}</div>`;
      if (Array.isArray(meal.items)) {
        html += `<div class="meal-items">${meal.items.map(i => escapeHtml(i)).join('<br>')}</div>`;
      }
      if (meal.macros) html += `<div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:6px">${escapeHtml(meal.macros)}</div>`;
      html += '</div>';
    }
  }
  return html || '<p>Nutrition details loading...</p>';
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatProgram(program) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build',
    '6wk_home': '6-Week Home',
    '12wk': '12-Week Custom',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack'
  };
  return labels[program] || program;
}
