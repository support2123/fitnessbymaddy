const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { sendDocument } = require('./lib/whatsapp');
const { cors, parseBody, maskPhone } = require('./lib/helpers');

const SYSTEM_PROMPT = `You are a certified fitness program architect working for FitnessByMaddy.
You design weekly training and nutrition plans for clients based on their check-in data, profile, and goals.

RULES:
- Never prescribe extreme calorie deficits below 1200 kcal for women or 1500 kcal for men
- Never recommend banned substances or unregulated supplements
- Never promise specific weight loss timelines
- Be evidence-based and conservative with progressions
- Account for reported injuries and medical conditions
- Include warm-up and cool-down in every workout
- Provide both gym and home alternatives when possible

OUTPUT FORMAT: Return valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "10-12", "rest": "60s", "notes": "" }] }
    ],
    "rest_days": ["Sunday"],
    "notes": ""
  },
  "nutrition_plan": {
    "daily_calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "...",
    "notes": ""
  },
  "weekly_focus": "...",
  "coach_note": "..."
}`;

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const { client_id, week_no } = body;

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

  const { data: lead } = client.lead_id
    ? await db.from('leads').select('first_msg, market').eq('id', client.lead_id).single()
    : { data: null };

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
    .order('week_no', { ascending: false })
    .limit(1)
    .single();

  let intakeData = {};
  try { intakeData = JSON.parse(lead?.first_msg || '{}'); } catch { /* not JSON intake */ }

  const userPrompt = `Design Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'N/A'}
- Program: ${client.program}
- Started: ${client.program_started_at}
- Intake data: ${JSON.stringify(intakeData)}

RECENT CHECK-INS:
${JSON.stringify(recentCheckins || [], null, 2)}

PREVIOUS WEEK PROGRAM:
${prevProgram ? JSON.stringify(prevProgram, null, 2) : 'No previous program (first week)'}

Generate a complete Week ${week_no} program. Adjust based on compliance, energy levels, and any reported issues.`;

  const anthropic = new Anthropic();

  let programJson;
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = message.content[0].text;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    programJson = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error(`Claude API error for ${maskPhone(client.phone)}: ${err.message}`);
    return res.status(500).json({ error: 'Program generation failed' });
  }

  if (programJson.nutrition_plan?.daily_calories < 1200) {
    await db.from('escalations').insert({
      phone: client.phone,
      trigger_reason: 'extreme_calorie_cut',
      message_body: `Generated plan has ${programJson.nutrition_plan.daily_calories} kcal for week ${week_no}`
    });
    return res.status(422).json({ error: 'Program flagged for review — calories too low' });
  }

  const { data: program, error } = await db.from('programs').insert({
    client_id,
    week_no,
    workout_plan: programJson.workout_plan,
    nutrition_plan: programJson.nutrition_plan,
    notes: programJson.coach_note || programJson.weekly_focus || null,
    pdf_url: null
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  const pdfHtml = buildProgramPdf(client, week_no, programJson);
  const pdfBlob = new Blob([pdfHtml], { type: 'text/html' });
  const pdfPath = `clients/${client_id}/week_${week_no}.html`;

  await db.storage.from('client-files').upload(pdfPath, pdfBlob, {
    contentType: 'text/html',
    upsert: true
  });

  const { data: publicUrl } = db.storage.from('client-files').getPublicUrl(pdfPath);

  await db.from('programs')
    .update({ pdf_url: publicUrl.publicUrl })
    .eq('id', program.id);

  const caption = programJson.weekly_focus
    ? `Week ${week_no}: ${programJson.weekly_focus}`
    : `Your Week ${week_no} program is ready!`;

  await sendDocument(client.phone, publicUrl.publicUrl, caption);

  await db.from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('id', program.id);

  console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);
  return res.json({ success: true, program_id: program.id, week_no });
};

function buildProgramPdf(client, weekNo, plan) {
  const workoutRows = (plan.workout_plan?.days || []).map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr><td>${ex.name}</td><td>${ex.sets}x${ex.reps}</td><td>${ex.rest || '-'}</td><td>${ex.notes || ''}</td></tr>`
    ).join('');
    return `<h3>${day.day} — ${day.focus}</h3><table><thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Notes</th></tr></thead><tbody>${exercises}</tbody></table>`;
  }).join('');

  const mealRows = (plan.nutrition_plan?.meals || []).map(m =>
    `<div class="meal"><strong>${m.meal}</strong><ul>${(m.options || []).map(o => `<li>${o}</li>`).join('')}</ul></div>`
  ).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=DM+Sans:wght@400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#1a1a1a;color:#FAF8F4;padding:40px 24px}
.header{text-align:center;padding:40px 0;border-bottom:2px solid #B8965A}
.header h1{font-family:'Cormorant Garamond',serif;font-size:42px;font-weight:600;color:#B8965A}
.header p{font-size:14px;color:rgba(255,255,255,0.6);margin-top:8px;letter-spacing:2px;text-transform:uppercase}
.section{margin:32px 0;padding:24px;background:rgba(255,255,255,0.04);border-radius:8px;border:1px solid rgba(255,255,255,0.08)}
h2{font-family:'Cormorant Garamond',serif;font-size:28px;color:#B8965A;margin-bottom:16px}
h3{font-size:16px;font-weight:600;color:#D4AF7A;margin:20px 0 12px;letter-spacing:1px;text-transform:uppercase}
table{width:100%;border-collapse:collapse;margin-bottom:20px}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.08);font-size:13px}
th{color:#B8965A;font-weight:600;letter-spacing:1px;text-transform:uppercase;font-size:11px}
.macros{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}
.macro{text-align:center;padding:16px;background:rgba(184,150,90,0.1);border-radius:6px;border:1px solid rgba(184,150,90,0.2)}
.macro .num{font-family:'Cormorant Garamond',serif;font-size:32px;font-weight:600;color:#B8965A}
.macro .label{font-size:11px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:1px;margin-top:4px}
.meal{margin:12px 0;padding:12px;background:rgba(255,255,255,0.03);border-radius:4px}
.meal ul{margin:8px 0 0 20px}
.meal li{font-size:13px;color:rgba(255,255,255,0.7);padding:4px 0}
.note{font-style:italic;color:rgba(255,255,255,0.6);padding:16px;background:rgba(184,150,90,0.08);border-left:3px solid #B8965A;border-radius:4px;margin-top:16px}
.footer{text-align:center;padding:32px 0;color:rgba(255,255,255,0.3);font-size:12px;letter-spacing:1px}
@media(max-width:600px){.macros{grid-template-columns:repeat(2,1fr)}}
</style></head><body>
<div class="header">
  <h1>Week ${weekNo} Program</h1>
  <p>${client.name || 'Your Personalized Plan'} — Fitness by Maddy</p>
</div>
${plan.weekly_focus ? `<div class="note" style="margin-top:24px">${plan.weekly_focus}</div>` : ''}
<div class="section"><h2>Workout Plan</h2>${workoutRows}
${plan.workout_plan?.notes ? `<div class="note">${plan.workout_plan.notes}</div>` : ''}
</div>
<div class="section"><h2>Nutrition Plan</h2>
<div class="macros">
  <div class="macro"><div class="num">${plan.nutrition_plan?.daily_calories || '-'}</div><div class="label">Calories</div></div>
  <div class="macro"><div class="num">${plan.nutrition_plan?.protein_g || '-'}g</div><div class="label">Protein</div></div>
  <div class="macro"><div class="num">${plan.nutrition_plan?.carbs_g || '-'}g</div><div class="label">Carbs</div></div>
  <div class="macro"><div class="num">${plan.nutrition_plan?.fats_g || '-'}g</div><div class="label">Fats</div></div>
</div>
${mealRows}
${plan.nutrition_plan?.hydration ? `<p style="margin-top:12px;font-size:13px;color:rgba(255,255,255,0.6)">Hydration: ${plan.nutrition_plan.hydration}</p>` : ''}
${plan.nutrition_plan?.notes ? `<div class="note">${plan.nutrition_plan.notes}</div>` : ''}
</div>
${plan.coach_note ? `<div class="section"><h2>Coach's Note</h2><p style="font-size:15px;line-height:1.7;color:rgba(255,255,255,0.8)">${plan.coach_note}</p></div>` : ''}
<div class="footer">Fitness by Maddy &mdash; fitnessbymaddy.com</div>
</body></html>`;
}
