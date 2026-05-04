const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { notifyMaddy } = require('../lib/escalation');

const SAFETY_KEYWORDS = [
  'under 800 calories', 'under 900 calories', 'extreme calorie',
  'clenbuterol', 'dnp', 'dinitrophenol', 'anabolic steroid', 'sarm',
  'crash diet', 'water fast', 'lose 10kg in a week', 'lose 20lbs in a week'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_KEYWORDS.some(kw => lower.includes(kw));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: lead } = await supabase
      .from('leads')
      .select('meta')
      .eq('id', client.lead_id)
      .single();

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await supabase
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const intakeMeta = lead?.meta || {};

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Design weekly training and nutrition plans that are:
- Safe, evidence-based, and progressive
- Tailored to the client's check-in data, intake profile, and goals
- Realistic and sustainable (no extreme measures)
- Minimum 1200 calories for women, 1500 for men

Output ONLY valid JSON:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..." }
      ]}
    ],
    "cardio": { "frequency": "3x/week", "type": "...", "duration": "..." },
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 250,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "time": "7:00 AM", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "3-4L water daily"
  },
  "context_note": "One line summary for WhatsApp",
  "coach_notes": "Internal notes for Maddy"
}`;

    const checkinSummary = (checkins || []).map(c =>
      `Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, Compliance ${c.compliance_score || '?'}/10, Energy ${c.energy || '?'}/10, Issues: ${c.issues || 'None'}`
    ).join('\n') || 'No check-ins yet';

    const userPrompt = `Client: ${client.name || 'Client'}
Program: ${client.program}
Week: ${week_no} of 12
Started: ${client.program_started_at}

Intake profile:
- Age: ${intakeMeta.age || 'Unknown'}
- Gender: ${intakeMeta.gender || 'Unknown'}
- Height: ${intakeMeta.height || 'Unknown'}
- Weight: ${intakeMeta.weight || 'Unknown'}
- Goal: ${intakeMeta.goal || 'General fitness'}
- Experience: ${intakeMeta.experience || 'Unknown'}
- Injuries: ${intakeMeta.injuries || 'None reported'}
- Diet preference: ${intakeMeta.diet_pref || 'No preference'}
- Schedule: ${intakeMeta.schedule || 'Flexible'}
- Medical: ${intakeMeta.medical || 'None'}

Recent check-ins:
${checkinSummary}

Previous program focus:
${prevPrograms?.[0]?.notes || 'First week — establish baseline'}

Design Week ${week_no} program.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;

    if (hasSafetyIssue(responseText)) {
      await notifyMaddy(
        'Program flagged for safety review',
        client.phone,
        `Week ${week_no} program may contain risky content`
      );
      await supabase.from('programs').insert({
        client_id, week_no,
        notes: 'FLAGGED: Awaiting Maddy safety review'
      });
      return res.status(200).json({ ok: true, flagged: true });
    }

    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const htmlContent = buildProgramHTML(client, week_no, programData);
    const filePath = `clients/${client_id}/week_${week_no}.html`;

    await supabase.storage
      .from('programs')
      .upload(filePath, Buffer.from(htmlContent), {
        contentType: 'text/html',
        upsert: true
      });

    const { data: urlData } = supabase.storage
      .from('programs')
      .getPublicUrl(filePath);

    await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: urlData.publicUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_notes || programData.context_note
    });

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      programData.context_note || `Your Week ${week_no} program is ready!`
    ]);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, week_no, url: urlData.publicUrl });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildProgramHTML(client, weekNo, data) {
  const workoutDays = (data.workout_plan?.days || []).map(day => {
    const rows = (day.exercises || []).map(ex =>
      `<tr><td>${ex.name}</td><td>${ex.sets} x ${ex.reps}</td><td>${ex.rest || '-'}</td><td>${ex.notes || ''}</td></tr>`
    ).join('');
    return `<div class="day-block">
      <h3>${day.day} &mdash; ${day.focus}</h3>
      <table><thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Notes</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }).join('');

  const meals = (data.nutrition_plan?.meals || []).map(m =>
    `<div class="meal"><strong>${m.meal}</strong> (${m.time})<ul>${(m.options || []).map(o => `<li>${o}</li>`).join('')}</ul></div>`
  ).join('');

  const np = data.nutrition_plan || {};
  const cardio = data.workout_plan?.cardio;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Week ${weekNo} &mdash; ${client.name || 'Client'} | Fitness by Maddy</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#0a0a0a;color:#e0e0e0}
.header{background:linear-gradient(135deg,#1a1a1a,#0a0a0a);padding:48px 32px;border-bottom:3px solid #B8965A;text-align:center}
.header h1{font-family:'Bebas Neue',sans-serif;font-size:48px;color:#B8965A;letter-spacing:4px}
.header p{font-size:14px;color:#888;margin-top:8px;letter-spacing:2px;text-transform:uppercase}
.container{max-width:800px;margin:0 auto;padding:32px}
.section-title{font-family:'Bebas Neue',sans-serif;font-size:28px;color:#B8965A;letter-spacing:3px;margin:32px 0 16px;border-bottom:1px solid #333;padding-bottom:8px}
.day-block{background:#141414;border:1px solid #222;border-radius:4px;padding:20px;margin-bottom:16px}
.day-block h3{font-family:'Bebas Neue',sans-serif;font-size:20px;color:#fff;letter-spacing:2px;margin-bottom:12px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:8px 12px;background:#1a1a1a;color:#B8965A;font-size:11px;letter-spacing:1px;text-transform:uppercase}
td{padding:8px 12px;border-bottom:1px solid #1a1a1a;color:#ccc}
.macros{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}
.macro-box{background:#141414;border:1px solid #222;border-radius:4px;padding:16px;text-align:center}
.macro-box .num{font-family:'Bebas Neue',sans-serif;font-size:32px;color:#B8965A}
.macro-box .label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-top:4px}
.meal{background:#141414;border:1px solid #222;border-radius:4px;padding:16px;margin-bottom:12px}
.meal strong{color:#fff;font-size:14px}.meal ul{margin-top:8px;padding-left:20px;color:#aaa;font-size:13px}
.meal li{margin-bottom:4px}
.cardio-box{background:#141414;border:1px solid #B8965A;border-radius:4px;padding:20px;margin-top:16px}
.footer-note{text-align:center;padding:32px;color:#555;font-size:12px;letter-spacing:1px}
@media(max-width:600px){.macros{grid-template-columns:repeat(2,1fr)}.container{padding:16px}}
</style>
</head>
<body>
<div class="header">
  <h1>Fitness by Maddy</h1>
  <p>${client.name || 'Client'} &mdash; Week ${weekNo} of 12</p>
</div>
<div class="container">
  <h2 class="section-title">Workout Plan</h2>
  ${workoutDays}
  ${cardio ? `<div class="cardio-box"><strong style="color:#B8965A">Cardio:</strong> ${cardio.frequency} &mdash; ${cardio.type}, ${cardio.duration}</div>` : ''}
  <h2 class="section-title">Nutrition Plan</h2>
  <div class="macros">
    <div class="macro-box"><div class="num">${np.calories || '&mdash;'}</div><div class="label">Calories</div></div>
    <div class="macro-box"><div class="num">${np.protein_g || '&mdash;'}g</div><div class="label">Protein</div></div>
    <div class="macro-box"><div class="num">${np.carbs_g || '&mdash;'}g</div><div class="label">Carbs</div></div>
    <div class="macro-box"><div class="num">${np.fat_g || '&mdash;'}g</div><div class="label">Fat</div></div>
  </div>
  ${meals}
  ${np.supplements?.length ? `<p style="margin-top:16px;color:#888;font-size:13px"><strong style="color:#B8965A">Supplements:</strong> ${np.supplements.join(', ')}</p>` : ''}
  ${np.hydration ? `<p style="margin-top:8px;color:#888;font-size:13px"><strong style="color:#B8965A">Hydration:</strong> ${np.hydration}</p>` : ''}
</div>
<div class="footer-note">Generated by Fitness by Maddy Coaching System</div>
</body>
</html>`;
}
