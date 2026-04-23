const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/whatsapp');
const { cors, parseBody, programLabel } = require('./_lib/utils');
const { notifyMaddy } = require('./_lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const { client_id, week_no } = body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'missing client_id or week_no' });
  }

  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'client not found' });

  const { data: recentCheckins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: lead } = client.lead_id
    ? await db.from('leads').select('first_msg').eq('id', client.lead_id).single()
    : { data: null };

  let intakeProfile = {};
  if (lead && lead.first_msg) {
    try { intakeProfile = JSON.parse(lead.first_msg); } catch {}
  }

  const prompt = buildPrompt(client, intakeProfile, recentCheckins || [], week_no);

  const anthropic = new Anthropic();
  let aiResponse;
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });
    aiResponse = msg.content[0].text;
  } catch (e) {
    console.error('Claude API error:', e.message);
    return res.status(500).json({ error: 'AI generation failed' });
  }

  let parsed;
  try {
    const jsonMatch = aiResponse.match(/```json\s*([\s\S]*?)```/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[1] : aiResponse);
  } catch {
    parsed = { raw: aiResponse };
  }

  if (hasSafetyFlag(aiResponse)) {
    await notifyMaddy({
      phone: client.phone,
      reason: 'AI program flagged for review — may contain risky recommendations',
      message: `Client ${maskPhone(client.phone)} Week ${week_no}`,
      type: 'Program safety review',
    });
    return res.status(200).json({ action: 'flagged_for_review', week_no });
  }

  const pdfHtml = renderProgramPdf(client, parsed, week_no);
  const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');
  const pdfPath = `clients/${client_id}/week_${week_no}.html`;

  await db.storage.from('clients').upload(pdfPath, pdfBuffer, {
    contentType: 'text/html',
    upsert: true,
  });

  const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
  const pdfUrl = urlData?.publicUrl || pdfPath;

  const { error: progErr } = await db.from('programs').insert({
    client_id,
    week_no,
    pdf_url: pdfUrl,
    workout_plan: parsed.workout_plan || parsed.workout || null,
    nutrition_plan: parsed.nutrition_plan || parsed.nutrition || null,
    notes: parsed.notes || null,
  });

  if (progErr) {
    console.error('Program insert failed:', progErr);
    return res.status(500).json({ error: 'failed to save program' });
  }

  const contextNote = parsed.notes || `Week ${week_no} program ready!`;
  await sendWhatsApp(client.phone, 'weekly_program', [
    client.name || 'there',
    String(week_no),
    contextNote.slice(0, 200),
    pdfUrl,
  ]);

  await db.from('programs').update({
    whatsapp_sent_at: new Date().toISOString(),
  }).eq('client_id', client_id).eq('week_no', week_no);

  return res.status(200).json({ success: true, week_no, pdf_url: pdfUrl });
};

function buildPrompt(client, intake, checkins, weekNo) {
  return `You are "Program Architect" for Fitness by Maddy, an elite online coaching brand.

Generate a detailed, personalised Week ${weekNo} program for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${programLabel(client.program)}
- Started: ${client.program_started_at}
- Age: ${intake.age || 'unknown'} | Gender: ${intake.gender || 'unknown'}
- Height: ${intake.height || 'unknown'} | Current weight: ${intake.weight || 'unknown'}
- Goal: ${intake.goal || 'general fitness'}
- Injuries/conditions: ${intake.injuries || 'none reported'}
- Diet preference: ${intake.diet_preference || 'flexible'}
- Schedule: ${intake.schedule || '4-5 days/week'}
- Experience: ${intake.experience || 'intermediate'}

RECENT CHECK-INS:
${checkins.length > 0 ? checkins.map(c => `Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, Compliance ${c.compliance_score || '?'}/10, Energy ${c.energy || '?'}/10, Issues: ${c.issues || 'none'}`).join('\n') : 'No check-ins yet (first week)'}

OUTPUT FORMAT — return valid JSON:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "..." }
        ]
      }
    ],
    "cardio": "..."
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 165,
    "carbs_g": 220,
    "fat_g": 73,
    "meals": [
      { "meal": "Meal 1", "time": "7am", "description": "..." }
    ],
    "supplements": "..."
  },
  "notes": "One-liner summary of this week's focus and key adjustments"
}
\`\`\`

RULES:
- Never recommend fewer than 1200 calories for women or 1500 for men
- Never recommend banned/controlled substances
- Never promise specific weight loss timelines ("you WILL lose X in Y days")
- Adjust based on check-in data — if compliance is low, simplify
- If energy is low (< 5), consider a deload or calorie increase
- Keep exercises practical for a commercial gym or home setup
- Tone: expert, warm, motivating. Not bro-science.`;
}

function hasSafetyFlag(text) {
  const flags = [
    /under\s*1[0-2]00\s*cal/i,
    /stero/i, /clenbuterol/i, /dnp/i, /ephedra/i, /sarm/i,
    /guarantee.*lose/i, /you\s*will\s*lose\s*\d+\s*(kg|lb|pound)/i,
    /extreme.*fast/i, /water\s*fast/i,
  ];
  return flags.some(f => f.test(text));
}

function renderProgramPdf(client, plan, weekNo) {
  const workout = plan.workout_plan || plan.workout || {};
  const nutrition = plan.nutrition_plan || plan.nutrition || {};
  const days = workout.days || [];
  const meals = nutrition.meals || [];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#1a1a1a;color:#FAF8F4;padding:0}
.header{background:linear-gradient(135deg,#1a1a1a 0%,#2C2C2C 100%);padding:48px 40px;border-bottom:3px solid #B8965A}
.brand{font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:4px;color:#B8965A;text-transform:uppercase}
h1{font-family:'Bebas Neue',sans-serif;font-size:48px;color:#FAF8F4;letter-spacing:2px;margin:8px 0}
.meta{font-size:13px;color:#6B6B6B}
.section{padding:32px 40px}
h2{font-family:'Bebas Neue',sans-serif;font-size:28px;color:#B8965A;letter-spacing:2px;margin-bottom:16px;border-bottom:1px solid #333;padding-bottom:8px}
h3{font-family:'Bebas Neue',sans-serif;font-size:20px;color:#D4AF7A;margin:20px 0 12px;letter-spacing:1px}
table{width:100%;border-collapse:collapse;margin-bottom:24px}
th{background:#2C2C2C;color:#B8965A;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;padding:10px 12px;text-align:left}
td{padding:10px 12px;border-bottom:1px solid #333;font-size:13px;color:#E8E3DC}
tr:hover td{background:#2C2C2C}
.macro-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
.macro-box{background:#2C2C2C;padding:16px;text-align:center;border-radius:4px;border:1px solid #333}
.macro-num{font-family:'Bebas Neue',sans-serif;font-size:32px;color:#B8965A}
.macro-label{font-size:11px;color:#6B6B6B;text-transform:uppercase;letter-spacing:1px;margin-top:4px}
.notes{background:#2C2C2C;padding:20px;border-left:3px solid #B8965A;margin:24px 40px;font-size:14px;line-height:1.7;color:#D4AF7A}
.footer{text-align:center;padding:32px;font-size:11px;color:#6B6B6B;letter-spacing:1px}
@media print{body{background:white;color:#1a1a1a}td{color:#333}th{background:#f0f0f0;color:#1a1a1a}.header{background:#f5f5f5;border-color:#B8965A}h1{color:#1a1a1a}}
</style>
</head>
<body>
<div class="header">
  <div class="brand">Fitness by Maddy</div>
  <h1>WEEK ${weekNo} PROGRAM</h1>
  <div class="meta">${client.name || 'Client'} &middot; ${programLabel(client.program)} &middot; ${new Date().toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'})}</div>
</div>

${plan.notes ? `<div class="notes">${plan.notes}</div>` : ''}

<div class="section">
  <h2>WORKOUT PLAN</h2>
  ${days.map(day => `
  <h3>${day.day} — ${day.focus || ''}</h3>
  <table>
    <tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th><th>Notes</th></tr>
    ${(day.exercises || []).map(ex => `
    <tr>
      <td>${ex.name || ''}</td>
      <td>${ex.sets || ''}</td>
      <td>${ex.reps || ''}</td>
      <td>${ex.rest || ''}</td>
      <td>${ex.notes || ''}</td>
    </tr>`).join('')}
  </table>`).join('')}
  ${workout.cardio ? `<p style="margin-top:16px;color:#D4AF7A"><strong>Cardio:</strong> ${workout.cardio}</p>` : ''}
</div>

<div class="section">
  <h2>NUTRITION PLAN</h2>
  <div class="macro-grid">
    <div class="macro-box"><div class="macro-num">${nutrition.calories || '—'}</div><div class="macro-label">Calories</div></div>
    <div class="macro-box"><div class="macro-num">${nutrition.protein_g || '—'}g</div><div class="macro-label">Protein</div></div>
    <div class="macro-box"><div class="macro-num">${nutrition.carbs_g || '—'}g</div><div class="macro-label">Carbs</div></div>
    <div class="macro-box"><div class="macro-num">${nutrition.fat_g || '—'}g</div><div class="macro-label">Fat</div></div>
  </div>
  ${meals.length > 0 ? `
  <table>
    <tr><th>Meal</th><th>Time</th><th>Description</th></tr>
    ${meals.map(m => `<tr><td>${m.meal || ''}</td><td>${m.time || ''}</td><td>${m.description || ''}</td></tr>`).join('')}
  </table>` : ''}
  ${nutrition.supplements ? `<p style="color:#D4AF7A"><strong>Supplements:</strong> ${nutrition.supplements}</p>` : ''}
</div>

<div class="footer">FITNESS BY MADDY &middot; FITNESSBYMADDY.COM &middot; @FITNESSBYMADDY_</div>
</body>
</html>`;
}
