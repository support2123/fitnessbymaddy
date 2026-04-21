const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { cors, parseBody } = require('./lib/helpers');

const SAFETY_FLAGS = [
  /below 1[0-2]00\s*cal/i,
  /steroi/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedra/i,
  /extreme.*(fast|cut|restrict)/i,
  /lose.*1[5-9]|2[0-9].*kg.*week/i,
];

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = await parseBody(req);
  const { client_id, week_no } = body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
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
    .from('clients')
    .download(`clients/${client_id}/intake.json`);

  let intake = {};
  if (intakeFile) {
    try { intake = JSON.parse(await intakeFile.text()); } catch {}
  }

  const prompt = buildProgramPrompt(client, intake, recentCheckins || [], week_no);

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0]?.text || '';

  for (const flag of SAFETY_FLAGS) {
    if (flag.test(content)) {
      await sendWhatsApp({
        phone: process.env.MADDY_PHONE || '+917082478374',
        templateName: 'escalation_alert',
        params: [client.name || client.phone, 'UNSAFE_PROGRAM', `Week ${week_no} flagged: ${flag.source}`],
      });
      return res.status(200).json({ action: 'flagged_for_review', reason: flag.source });
    }
  }

  let workout_plan, nutrition_plan, notes;
  try {
    const parsed = JSON.parse(content);
    workout_plan = parsed.workout_plan || parsed.workouts;
    nutrition_plan = parsed.nutrition_plan || parsed.nutrition;
    notes = parsed.notes || parsed.coach_notes || '';
  } catch {
    workout_plan = { raw: content };
    nutrition_plan = {};
    notes = '';
  }

  const { error } = await db.from('programs').upsert({
    client_id,
    week_no: parseInt(week_no),
    generated_at: new Date().toISOString(),
    workout_plan,
    nutrition_plan,
    notes,
  }, { onConflict: 'client_id,week_no' });

  if (error) {
    console.error('[PROGRAM] Insert error:', error.message);
    return res.status(500).json({ error: 'Failed to save program' });
  }

  const pdfContent = generatePdfHtml(client, week_no, workout_plan, nutrition_plan, notes);
  const pdfPath = `clients/${client_id}/week_${week_no}.html`;

  await db.storage.from('clients').upload(pdfPath, pdfContent, {
    contentType: 'text/html',
    upsert: true,
  });

  const { data: urlData } = await db.storage
    .from('clients')
    .createSignedUrl(pdfPath, 7 * 24 * 60 * 60);

  const pdfUrl = urlData?.signedUrl || '';

  await db.from('programs').update({
    pdf_url: pdfUrl,
    whatsapp_sent_at: new Date().toISOString(),
  }).eq('client_id', client_id).eq('week_no', parseInt(week_no));

  if (pdfUrl) {
    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      params: [client.name || 'there', `Week ${week_no}`],
      mediaUrl: pdfUrl,
    });
  }

  return res.status(200).json({ success: true, week_no, pdf_url: pdfUrl });
};

function buildProgramPrompt(client, intake, checkins, weekNo) {
  const lastCheckin = checkins[0] || {};
  const prevCheckin = checkins[1] || {};

  return `You are an elite fitness coach creating a personalized weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
- Goal: ${intake.goal || 'general fitness'}
- Injuries/limitations: ${intake.injuries || 'none reported'}
- Diet preference: ${intake.diet_pref || 'flexible'}
- Schedule: ${intake.schedule || '5 days/week'}
- Age: ${intake.age || 'not specified'}

LATEST CHECK-IN (Week ${lastCheckin.week_no || 'N/A'}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'none'}

PREVIOUS CHECK-IN (Week ${prevCheckin.week_no || 'N/A'}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10

INSTRUCTIONS:
1. Create a complete workout plan for this week (${intake.schedule || '5'} training days)
2. Create a nutrition plan with macros and meal timing
3. Adjust intensity based on compliance and energy scores
4. If compliance is low, simplify. If energy is high, push harder.
5. Include a coach's note with 1-2 motivational sentences.
6. NEVER recommend extreme calorie restriction (<1200 cal), banned substances, or unrealistic timelines.

OUTPUT FORMAT (strict JSON):
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name":"...","sets":3,"reps":"8-12","rest":"60s"}] }
    ]
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meals": [{"time":"...","description":"..."}]
  },
  "notes": "Coach's note here"
}`;
}

function generatePdfHtml(client, weekNo, workout, nutrition, notes) {
  const days = workout?.days || [];
  const workoutRows = days.map(d => {
    const exercises = (d.exercises || []).map(e =>
      `<tr><td>${e.name}</td><td>${e.sets}x${e.reps}</td><td>${e.rest || '60s'}</td></tr>`
    ).join('');
    return `<h3>${d.day} — ${d.focus || ''}</h3><table><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th></tr>${exercises}</table>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body{font-family:'DM Sans',sans-serif;background:#1a1a1a;color:#fff;padding:40px;max-width:800px;margin:auto}
h1,h2,h3{font-family:'Bebas Neue',sans-serif;color:#D4AF7A;text-transform:uppercase;letter-spacing:2px}
h1{font-size:32px;border-bottom:2px solid #D4AF7A;padding-bottom:10px}
table{width:100%;border-collapse:collapse;margin:10px 0 20px}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #333}
th{color:#D4AF7A;font-size:12px;text-transform:uppercase;letter-spacing:1px}
.nutrition{background:#222;padding:20px;border-radius:8px;margin:20px 0}
.note{font-style:italic;color:#aaa;margin-top:20px;padding:15px;border-left:3px solid #D4AF7A}
.brand{text-align:center;margin-top:40px;font-size:12px;color:#666}
</style>
</head>
<body>
<h1>FitnessByMaddy — Week ${weekNo}</h1>
<p>Client: ${client.name || 'Client'} | Program: ${client.program}</p>
<h2>Workout Plan</h2>
${workoutRows || '<p>Custom plan details in app</p>'}
<h2>Nutrition Plan</h2>
<div class="nutrition">
<p><strong>Calories:</strong> ${nutrition?.calories || 'TBD'} kcal</p>
<p><strong>Protein:</strong> ${nutrition?.protein_g || 'TBD'}g | <strong>Carbs:</strong> ${nutrition?.carbs_g || 'TBD'}g | <strong>Fats:</strong> ${nutrition?.fats_g || 'TBD'}g</p>
</div>
${notes ? `<div class="note">${notes}</div>` : ''}
<div class="brand">FitnessByMaddy | fitnessbymaddy.com</div>
</body>
</html>`;
}
