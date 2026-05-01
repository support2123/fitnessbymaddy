const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000', 'under 800', 'starvation',
  'banned substance', 'steroid', 'dnp', 'clenbuterol', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

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

    const { data: intakeFile } = await db.storage
      .from('client-data')
      .download(`intakes/${client.lead_id}.json`);

    let intakeData = null;
    if (intakeFile) {
      try {
        const text = await intakeFile.text();
        intakeData = JSON.parse(text);
      } catch (e) { /* no intake data */ }
    }

    const prompt = buildPrompt(client, recentCheckins || [], intakeData, week_no);

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

    const lowerResponse = responseText.toLowerCase();
    const flagged = SAFETY_FLAGS.some(f => lowerResponse.includes(f));
    if (flagged) {
      await escalateToMaddy(
        'Program safety flag',
        client.phone,
        `Week ${week_no} program flagged for review`
      );
      return res.status(200).json({
        success: false,
        reason: 'flagged_for_review',
        message: 'Program flagged for Maddy review'
      });
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const parsed = JSON.parse(responseText);
      workoutPlan = parsed.workout_plan || parsed.workouts || {};
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition || {};
      notes = parsed.notes || parsed.coach_notes || '';
    } catch (e) {
      workoutPlan = { raw: responseText };
      nutritionPlan = {};
      notes = 'Raw format — review recommended';
    }

    const pdfContent = generatePdfHtml(client, week_no, workoutPlan, nutritionPlan, notes);
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await db.storage.from('client-data').upload(
      pdfPath,
      pdfContent,
      { contentType: 'text/html', upsert: true }
    );

    const { data: urlData } = db.storage
      .from('client-data')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes
    }).select().single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      pdfUrl
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({
      success: true,
      program_id: program.id,
      pdf_url: pdfUrl
    });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildPrompt(client, checkins, intake, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a NASM-certified fitness program architect for FitnessByMaddy.

Generate a Week ${weekNo} program for this client. Return valid JSON only.

CLIENT PROFILE:
- Name: ${client.name || 'Unknown'}
- Program: ${client.program}
- Started: ${client.program_started_at}
${intake ? `- Age: ${intake.age}, Gender: ${intake.gender}
- Goal: ${intake.goal}
- Injuries: ${intake.injuries || 'None'}
- Diet: ${intake.diet_preference || 'No preference'}
- Schedule: ${intake.schedule || 'Flexible'}` : ''}

${lastCheckin ? `LAST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight}kg, Waist: ${lastCheckin.waist}cm
- Compliance: ${lastCheckin.compliance_score}/10, Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'None'}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight}kg, Waist: ${prevCheckin.waist}cm
- Compliance: ${prevCheckin.compliance_score}/10, Energy: ${prevCheckin.energy}/10` : ''}

RULES:
- Progressive overload from previous week
- If compliance < 6, reduce volume slightly
- If energy < 5, add a deload day
- Never recommend under 1200 calories for women or 1500 for men
- No banned substances or extreme protocols
- Include warm-up and cool-down

Return JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }] }
    ],
    "rest_days": ["Sunday"],
    "warmup": "...",
    "cooldown": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [{ "meal": "Breakfast", "options": ["..."] }],
    "hydration": "...",
    "supplements": ["..."]
  },
  "notes": "Coach notes for the client"
}`;
}

function generatePdfHtml(client, weekNo, workout, nutrition, notes) {
  const days = workout.days || [];
  const meals = nutrition.meals || [];

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=DM+Sans:wght@300;400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#FAF8F4;color:#2C2C2C;padding:40px 24px;max-width:800px;margin:0 auto}
.header{text-align:center;padding:40px 0;border-bottom:2px solid #B8965A}
.brand{font-family:'Cormorant Garamond',serif;font-size:28px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:#2C2C2C}
.week-title{font-family:'Cormorant Garamond',serif;font-size:42px;font-weight:600;color:#B8965A;margin-top:12px}
.client-name{font-size:14px;color:#6B6B6B;letter-spacing:2px;text-transform:uppercase;margin-top:8px}
.section{margin-top:40px}
.section-title{font-family:'Cormorant Garamond',serif;font-size:28px;font-weight:600;color:#2C2C2C;margin-bottom:20px;padding-bottom:8px;border-bottom:1px solid #E8E3DC}
.day-block{background:#fff;border:1px solid #E8E3DC;border-radius:4px;padding:24px;margin-bottom:16px}
.day-name{font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#B8965A;margin-bottom:12px}
.exercise{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #F0EAE0;font-size:14px}
.exercise:last-child{border-bottom:none}
.ex-name{font-weight:500}
.ex-detail{color:#6B6B6B;font-size:13px}
.macro-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
.macro-card{background:#fff;border:1px solid #E8E3DC;border-radius:4px;padding:16px;text-align:center}
.macro-val{font-family:'Cormorant Garamond',serif;font-size:32px;font-weight:600;color:#B8965A}
.macro-label{font-size:11px;color:#6B6B6B;letter-spacing:1px;text-transform:uppercase;margin-top:4px}
.meal-block{background:#fff;border:1px solid #E8E3DC;border-radius:4px;padding:20px;margin-bottom:12px}
.meal-name{font-weight:600;font-size:14px;margin-bottom:8px;color:#2C2C2C}
.meal-options{font-size:13px;color:#6B6B6B;line-height:1.6}
.notes-box{background:#2C2C2C;color:#FAF8F4;border-radius:4px;padding:24px;margin-top:40px}
.notes-title{font-family:'Cormorant Garamond',serif;font-size:22px;color:#B8965A;margin-bottom:12px}
.notes-text{font-size:14px;line-height:1.7;color:rgba(250,248,244,0.8)}
.footer{text-align:center;margin-top:48px;padding-top:24px;border-top:1px solid #E8E3DC;font-size:12px;color:#6B6B6B}
@media print{body{padding:20px}@page{margin:1cm}}
</style>
</head>
<body>
<div class="header">
<div class="brand">Fitness by Maddy</div>
<div class="week-title">Week ${weekNo}</div>
<div class="client-name">${client.name || 'Your Program'}</div>
</div>
<div class="section">
<div class="section-title">Workout Plan</div>
${workout.warmup ? `<p style="font-size:14px;color:#6B6B6B;margin-bottom:16px"><strong>Warm-up:</strong> ${workout.warmup}</p>` : ''}
${days.map(day => `
<div class="day-block">
<div class="day-name">${day.day} — ${day.focus || ''}</div>
${(day.exercises || []).map(ex => `
<div class="exercise">
<span class="ex-name">${ex.name}</span>
<span class="ex-detail">${ex.sets || 3} x ${ex.reps || '8-12'} | Rest: ${ex.rest || '60s'}</span>
</div>`).join('')}
</div>`).join('')}
${workout.cooldown ? `<p style="font-size:14px;color:#6B6B6B;margin-top:8px"><strong>Cool-down:</strong> ${workout.cooldown}</p>` : ''}
</div>
<div class="section">
<div class="section-title">Nutrition Plan</div>
<div class="macro-grid">
<div class="macro-card"><div class="macro-val">${nutrition.calories || '—'}</div><div class="macro-label">Calories</div></div>
<div class="macro-card"><div class="macro-val">${nutrition.protein_g || '—'}g</div><div class="macro-label">Protein</div></div>
<div class="macro-card"><div class="macro-val">${nutrition.carbs_g || '—'}g</div><div class="macro-label">Carbs</div></div>
<div class="macro-card"><div class="macro-val">${nutrition.fat_g || '—'}g</div><div class="macro-label">Fat</div></div>
</div>
${meals.map(m => `
<div class="meal-block">
<div class="meal-name">${m.meal}</div>
<div class="meal-options">${(m.options || []).join(' · ')}</div>
</div>`).join('')}
${nutrition.hydration ? `<p style="font-size:14px;color:#6B6B6B;margin-top:12px"><strong>Hydration:</strong> ${nutrition.hydration}</p>` : ''}
</div>
${notes ? `
<div class="notes-box">
<div class="notes-title">Coach Notes</div>
<div class="notes-text">${notes}</div>
</div>` : ''}
<div class="footer">Fitness by Maddy · fitnessbymaddy.com · Your journey, your transformation</div>
</body>
</html>`;
}
