const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { sendMediaMessage, sendTextMessage } = require('../lib/whatsapp');
const { getLanguage } = require('../lib/market');

const SAFETY_BLACKLIST = [
  'dnp', 'clenbuterol', 'ephedra', 'anabolic', 'steroid',
  'sarm', 'hgh', 'insulin', 'diuretic',
];

const MIN_CALORIES = 1200;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*, leads(market)')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intake } = await supabase
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: prevProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .maybeSingle();

    const anthropic = new Anthropic();
    const prompt = buildPrompt(client, checkins || [], intake, prevProgram, week_no);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
      system: SYSTEM_PROMPT,
    });

    const responseText = message.content[0].text;
    let parsed;
    try {
      const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : responseText);
    } catch {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Invalid program format from AI' });
    }

    const safetyIssue = checkSafety(parsed);
    if (safetyIssue) {
      await supabase.from('escalations').insert({
        phone: client.phone,
        trigger_keyword: 'unsafe_program',
        message_body: `Week ${week_no} program flagged: ${safetyIssue}`,
      });
      return res.status(200).json({
        ok: false,
        flagged: true,
        reason: safetyIssue,
      });
    }

    const pdfHtml = renderProgramPdf(client, parsed, week_no);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await supabase.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'text/html',
        upsert: true,
      });

    const { data: urlData } = supabase.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { error: insertErr } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.notes || null,
    });

    if (insertErr) {
      console.error('Program insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const market = client.leads?.market || 'GLOBAL';
    const lang = getLanguage(market);
    const contextNote = lang === 'hinglish'
      ? `Week ${week_no} ka program ready hai! 💪 ${parsed.notes || 'Iss hafte focus rakhna.'}`
      : `Your Week ${week_no} program is ready! 💪 ${parsed.notes || 'Stay focused this week.'}`;

    await sendTextMessage(client.phone, contextNote + `\n\nView your plan: ${pdfUrl}`);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const SYSTEM_PROMPT = `You are Maddy's AI program architect for FitnessByMaddy. You generate weekly workout and nutrition plans for clients based on their check-in data, goals, and profile.

Output ONLY valid JSON with this structure:
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
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "description": "3 eggs + 2 toast + fruit", "protein_g": 30 }
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3-4L water daily"
  },
  "notes": "One line weekly focus note for the client"
}

Rules:
- Never recommend banned substances, SARMs, steroids, or extreme protocols
- Minimum 1200 calories for any plan
- Account for injuries and medical conditions
- Progressive overload: slightly increase intensity from previous week
- Be specific with exercise names, sets, reps, and rest periods
- Adapt nutrition to client's dietary preferences`;

function buildPrompt(client, checkins, intake, prevProgram, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${client.program}\n`;

  if (intake) {
    prompt += `Age: ${intake.age || 'unknown'}\n`;
    prompt += `Gender: ${intake.gender || 'unknown'}\n`;
    prompt += `Goal: ${intake.goal || 'general fitness'}\n`;
    prompt += `Injuries: ${intake.injuries || 'none reported'}\n`;
    prompt += `Medical: ${intake.medical_conditions || 'none'}\n`;
    prompt += `Diet preference: ${intake.diet_preference || 'no restrictions'}\n`;
    prompt += `Experience: ${intake.workout_experience || 'intermediate'}\n`;
    prompt += `Available days: ${intake.available_days || 5}\n`;
    prompt += `Equipment: ${intake.equipment_access || 'full gym'}\n`;
  }

  if (checkins.length > 0) {
    prompt += `\nRecent check-ins:\n`;
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10`;
      if (c.issues) prompt += `, issues: ${c.issues}`;
      prompt += '\n';
    }
  }

  if (prevProgram) {
    prompt += `\nPrevious week plan summary:\n`;
    prompt += `Calories: ${prevProgram.nutrition_plan?.calories || 'N/A'}\n`;
    prompt += `Training days: ${prevProgram.workout_plan?.days?.length || 'N/A'}\n`;
    if (prevProgram.notes) prompt += `Notes: ${prevProgram.notes}\n`;
  }

  return prompt;
}

function checkSafety(parsed) {
  const text = JSON.stringify(parsed).toLowerCase();
  for (const term of SAFETY_BLACKLIST) {
    if (text.includes(term)) return `Contains blacklisted term: ${term}`;
  }
  const calories = parsed?.nutrition_plan?.calories;
  if (calories && calories < MIN_CALORIES) {
    return `Calories too low: ${calories} (minimum ${MIN_CALORIES})`;
  }
  return null;
}

function renderProgramPdf(client, program, weekNo) {
  const days = program.workout_plan?.days || [];
  const nutrition = program.nutrition_plan || {};
  const meals = nutrition.meals || [];

  let workoutRows = '';
  for (const day of days) {
    workoutRows += `<tr class="day-header"><td colspan="5">${day.day} — ${day.focus}</td></tr>`;
    for (const ex of day.exercises || []) {
      workoutRows += `<tr><td>${ex.name}</td><td>${ex.sets}</td><td>${ex.reps}</td><td>${ex.rest}</td><td>${ex.notes || ''}</td></tr>`;
    }
    if (day.cardio) {
      workoutRows += `<tr><td colspan="5" style="font-style:italic;color:#6B6B6B;">Cardio: ${day.cardio}</td></tr>`;
    }
  }

  let mealRows = '';
  for (const m of meals) {
    mealRows += `<tr><td>${m.meal}</td><td>${m.description}</td><td>${m.protein_g || '-'}g</td></tr>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=DM+Sans:wght@300;400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#FAF8F4;color:#2C2C2C;padding:40px 24px}
.header{background:#2C2C2C;color:#fff;padding:32px;margin:-40px -24px 32px;text-align:center}
.header h1{font-family:'Cormorant Garamond',serif;font-size:28px;font-weight:600;letter-spacing:2px;color:#B8965A}
.header p{font-size:13px;color:rgba(255,255,255,0.6);margin-top:8px;letter-spacing:1px}
.section-title{font-family:'Cormorant Garamond',serif;font-size:22px;color:#2C2C2C;border-bottom:2px solid #B8965A;padding-bottom:8px;margin:32px 0 16px}
table{width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px}
th{background:#2C2C2C;color:#fff;padding:10px 12px;text-align:left;font-size:11px;letter-spacing:1px;text-transform:uppercase}
td{padding:8px 12px;border-bottom:1px solid #E8E3DC}
.day-header td{background:#F0EAE0;font-weight:600;font-size:14px;color:#2C2C2C;padding:12px}
.macros{display:flex;gap:16px;flex-wrap:wrap;margin:16px 0}
.macro-box{background:#2C2C2C;color:#fff;padding:16px 20px;border-radius:4px;text-align:center;flex:1;min-width:80px}
.macro-box .num{font-family:'Cormorant Garamond',serif;font-size:28px;font-weight:600;color:#B8965A}
.macro-box .label{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,0.6);margin-top:4px}
.notes{background:#F0EAE0;padding:20px;border-left:3px solid #B8965A;margin:24px 0;font-size:14px;line-height:1.6}
.footer{text-align:center;margin-top:40px;font-size:11px;color:#6B6B6B;letter-spacing:1px}
</style>
</head>
<body>
<div class="header">
  <h1>WEEK ${weekNo} PROGRAM</h1>
  <p>${client.name || 'Client'} · ${client.program?.replace('_', ' ').toUpperCase()}</p>
</div>

<h2 class="section-title">Workout Plan</h2>
<table>
<thead><tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th><th>Notes</th></tr></thead>
<tbody>${workoutRows}</tbody>
</table>

<h2 class="section-title">Nutrition Plan</h2>
<div class="macros">
  <div class="macro-box"><div class="num">${nutrition.calories || '-'}</div><div class="label">Calories</div></div>
  <div class="macro-box"><div class="num">${nutrition.protein_g || '-'}g</div><div class="label">Protein</div></div>
  <div class="macro-box"><div class="num">${nutrition.carbs_g || '-'}g</div><div class="label">Carbs</div></div>
  <div class="macro-box"><div class="num">${nutrition.fat_g || '-'}g</div><div class="label">Fat</div></div>
</div>

<table>
<thead><tr><th>Meal</th><th>Description</th><th>Protein</th></tr></thead>
<tbody>${mealRows}</tbody>
</table>

${nutrition.supplements ? `<p style="margin:16px 0;font-size:13px"><strong>Supplements:</strong> ${nutrition.supplements.join(', ')}</p>` : ''}
${nutrition.hydration ? `<p style="margin:8px 0;font-size:13px"><strong>Hydration:</strong> ${nutrition.hydration}</p>` : ''}

${program.notes ? `<div class="notes">${program.notes}</div>` : ''}

<div class="footer">FITNESS BY MADDY · fitnessbymaddy.com</div>
</body>
</html>`;
}
