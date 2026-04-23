const { supabase } = require('./_lib/supabase');
const { maskPhone } = require('./_lib/helpers');
const { sendText, notifyMaddy } = require('./_lib/whatsapp');

const SAFETY_PATTERNS = [
  /\b(dnp|clenbuterol|steroid|sarm|ephedra)\b/i,
  /\b(under\s*800|under\s*900|500\s*cal|600\s*cal|700\s*cal)\b/i,
  /\b(lose\s*10\s*kg.*week|lose\s*20.*month)\b/i
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients').select('*').eq('id', client_id).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    let intakeData = null;
    try {
      const { data: fileData } = await supabase.storage
        .from('clients')
        .download(`intakes/${client.lead_id}.json`);
      if (fileData) {
        intakeData = JSON.parse(await fileData.text());
      }
    } catch (e) { /* no intake data available */ }

    const prompt = buildPrompt(client, recentCheckins || [], intakeData, week_no);

    const claudeKey = process.env.CLAUDE_API_KEY;
    if (!claudeKey) {
      return res.status(500).json({ error: 'CLAUDE_API_KEY not configured' });
    }

    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: 'You are a certified fitness program architect for FitnessByMaddy. Output valid JSON only. Never recommend banned substances, extreme calorie restrictions below 1200 kcal, or unrealistic timelines.',
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!claudeResp.ok) {
      const errText = await claudeResp.text();
      console.error('[GenProg] Claude API error:', errText);
      return res.status(502).json({ error: 'Claude API error' });
    }

    const claudeData = await claudeResp.json();
    const rawOutput = claudeData.content?.[0]?.text || '';

    for (const pattern of SAFETY_PATTERNS) {
      if (pattern.test(rawOutput)) {
        await supabase.from('escalations').insert({
          phone: client.phone,
          reason: 'unsafe_program_content',
          message_body: `Week ${week_no}: safety pattern matched in generated content`
        });
        await notifyMaddy('Unsafe Program Content',
          `Client: ${maskPhone(client.phone)}\nWeek: ${week_no}\nContent flagged for review.`);
        return res.json({ status: 'flagged', reason: 'safety_check_failed' });
      }
    }

    let parsedPlan;
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      parsedPlan = JSON.parse(jsonMatch ? jsonMatch[0] : rawOutput);
    } catch (e) {
      console.error('[GenProg] Failed to parse Claude output');
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const pdfHtml = renderProgramPdf(client, week_no, parsedPlan);
    const pdfPath = `clients/${client.id}/week_${week_no}.html`;
    await supabase.storage.from('clients').upload(pdfPath, pdfHtml, {
      contentType: 'text/html',
      upsert: true
    });

    const { data: publicUrl } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);

    const { data: program, error } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: publicUrl?.publicUrl || pdfPath,
      workout_plan: parsedPlan.workout || parsedPlan.workout_plan || {},
      nutrition_plan: parsedPlan.nutrition || parsedPlan.nutrition_plan || {},
      notes: parsedPlan.coach_note || ''
    }).select().single();

    if (error) throw error;

    const weekMsg = `Your Week ${week_no} program is ready! 💪\n\n${parsedPlan.coach_note || 'Let\'s keep the momentum going!'}\n\nView: ${publicUrl?.publicUrl || 'Check your client portal'}`;
    const sendResult = await sendText(client.phone, weekMsg);

    if (sendResult.ok) {
      await supabase.from('programs').update({
        whatsapp_sent_at: new Date().toISOString()
      }).eq('id', program.id);
    }

    console.log(`[GenProg] ${maskPhone(client.phone)} week=${week_no}`);
    return res.json({ status: 'ok', program_id: program.id });
  } catch (err) {
    console.error('[GenProg Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, intake, weekNo) {
  let prompt = `Generate a Week ${weekNo} program for this client.\n\n`;
  prompt += `Client: ${client.name || 'Unknown'}\n`;
  prompt += `Program: ${client.program}\n`;

  if (intake) {
    prompt += `\nIntake Data:\n`;
    prompt += `Age: ${intake.age || '?'}, Gender: ${intake.gender || '?'}\n`;
    prompt += `Height: ${intake.height || '?'}, Weight: ${intake.weight || '?'}\n`;
    prompt += `Goal: ${intake.goal || '?'}\n`;
    prompt += `Experience: ${intake.experience_level || '?'}\n`;
    prompt += `Equipment: ${intake.equipment_access || '?'}\n`;
    prompt += `Diet Preference: ${intake.diet_pref || '?'}\n`;
    prompt += `Injuries: ${intake.injuries || 'none'}\n`;
    prompt += `Schedule: ${intake.schedule || '?'}\n`;
  }

  if (checkins.length > 0) {
    prompt += `\nRecent Check-ins:\n`;
    for (const c of checkins) {
      prompt += `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, `;
      prompt += `Compliance=${c.compliance_score}/10, Energy=${c.energy}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      prompt += `\n`;
    }
  }

  prompt += `\nRespond with a JSON object containing:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..." }
      ]}
    ],
    "cardio": "...",
    "rest_days": "..."
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_timing": "...",
    "sample_meals": [
      { "meal": "Breakfast", "options": ["...", "..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "coach_note": "A 1-2 sentence personalized note for the client"
}`;

  return prompt;
}

function renderProgramPdf(client, weekNo, plan) {
  const workout = plan.workout_plan || plan.workout || {};
  const nutrition = plan.nutrition_plan || plan.nutrition || {};
  const days = workout.days || [];
  const meals = nutrition.sample_meals || [];

  let workoutHtml = '';
  for (const day of days) {
    workoutHtml += `<div class="day-block"><h3>${day.day} — ${day.focus || ''}</h3><table><tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th><th>Notes</th></tr>`;
    for (const ex of (day.exercises || [])) {
      workoutHtml += `<tr><td>${ex.name}</td><td>${ex.sets}</td><td>${ex.reps}</td><td>${ex.rest || ''}</td><td>${ex.notes || ''}</td></tr>`;
    }
    workoutHtml += `</table></div>`;
  }

  let nutritionHtml = `<div class="macro-bar"><div class="macro"><span class="macro-num">${nutrition.calories || '—'}</span><span class="macro-label">Calories</span></div><div class="macro"><span class="macro-num">${nutrition.protein_g || '—'}g</span><span class="macro-label">Protein</span></div><div class="macro"><span class="macro-num">${nutrition.carbs_g || '—'}g</span><span class="macro-label">Carbs</span></div><div class="macro"><span class="macro-num">${nutrition.fats_g || '—'}g</span><span class="macro-label">Fats</span></div></div>`;

  let mealsHtml = '';
  for (const m of meals) {
    mealsHtml += `<div class="meal"><h4>${m.meal}</h4><ul>`;
    for (const opt of (m.options || [])) {
      mealsHtml += `<li>${opt}</li>`;
    }
    mealsHtml += `</ul></div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#1a1a1a;color:#fff;padding:0}
.header{background:#000;padding:40px;text-align:center;border-bottom:3px solid #B8965A}
.header h1{font-family:'Bebas Neue',sans-serif;font-size:48px;letter-spacing:4px;color:#B8965A}
.header h2{font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:2px;color:#fff;margin-top:8px}
.header p{color:rgba(255,255,255,0.5);font-size:13px;margin-top:8px}
.section{padding:32px 40px}
.section h2{font-family:'Bebas Neue',sans-serif;font-size:32px;color:#B8965A;letter-spacing:2px;margin-bottom:20px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:12px}
.day-block{margin-bottom:24px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:4px;padding:20px}
.day-block h3{font-family:'Bebas Neue',sans-serif;font-size:22px;color:#fff;letter-spacing:1px;margin-bottom:12px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:8px 12px;background:rgba(184,150,90,0.15);color:#B8965A;font-size:11px;letter-spacing:1px;text-transform:uppercase}
td{padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.06);color:rgba(255,255,255,0.8)}
.macro-bar{display:flex;gap:24px;margin-bottom:24px;flex-wrap:wrap}
.macro{background:rgba(184,150,90,0.1);border:1px solid rgba(184,150,90,0.3);border-radius:4px;padding:16px 24px;text-align:center;flex:1;min-width:100px}
.macro-num{display:block;font-family:'Bebas Neue',sans-serif;font-size:32px;color:#B8965A}
.macro-label{font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:1px;text-transform:uppercase}
.meal{margin-bottom:16px}
.meal h4{color:#B8965A;font-size:14px;margin-bottom:6px;letter-spacing:0.5px}
.meal ul{list-style:none;padding:0}
.meal li{padding:4px 0;color:rgba(255,255,255,0.7);font-size:13px}
.meal li::before{content:'→ ';color:#B8965A}
.coach-note{background:rgba(184,150,90,0.08);border-left:3px solid #B8965A;padding:20px 24px;margin:20px 40px;border-radius:0 4px 4px 0;font-style:italic;color:rgba(255,255,255,0.8)}
.footer{text-align:center;padding:32px;color:rgba(255,255,255,0.3);font-size:12px;border-top:1px solid rgba(255,255,255,0.06)}
@media(max-width:600px){.section{padding:20px 16px}.header{padding:24px 16px}.macro-bar{flex-direction:column}.coach-note{margin:16px}}
</style>
</head>
<body>
<div class="header">
  <h1>FITNESS BY MADDY</h1>
  <h2>WEEK ${weekNo} PROGRAM</h2>
  <p>${client.name || 'Client'} &middot; ${client.program.replace(/_/g, ' ').toUpperCase()}</p>
</div>
${plan.coach_note ? `<div class="coach-note">"${plan.coach_note}"</div>` : ''}
<div class="section"><h2>WORKOUT PLAN</h2>${workoutHtml}${workout.cardio ? `<p style="color:rgba(255,255,255,0.6);margin-top:12px"><strong style="color:#B8965A">Cardio:</strong> ${workout.cardio}</p>` : ''}${workout.rest_days ? `<p style="color:rgba(255,255,255,0.6);margin-top:8px"><strong style="color:#B8965A">Rest Days:</strong> ${workout.rest_days}</p>` : ''}</div>
<div class="section"><h2>NUTRITION PLAN</h2>${nutritionHtml}${mealsHtml}${nutrition.hydration ? `<p style="color:rgba(255,255,255,0.6);margin-top:12px"><strong style="color:#B8965A">Hydration:</strong> ${nutrition.hydration}</p>` : ''}${nutrition.supplements ? `<p style="color:rgba(255,255,255,0.6);margin-top:8px"><strong style="color:#B8965A">Supplements:</strong> ${Array.isArray(nutrition.supplements) ? nutrition.supplements.join(', ') : nutrition.supplements}</p>` : ''}</div>
<div class="footer">Fitness by Maddy &middot; fitnessbymaddy.com &middot; Generated ${new Date().toLocaleDateString()}</div>
</body></html>`;
}
