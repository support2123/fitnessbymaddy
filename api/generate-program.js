const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { json, parseBody } = require('../lib/utils');
const Anthropic = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, { ok: true });
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const body = await parseBody(req);
  const { client_id, week_no } = body;

  if (!client_id || !week_no) {
    return json(res, { error: 'client_id and week_no required' }, 400);
  }

  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return json(res, { error: 'client not found' }, 404);

  // Get last 2 check-ins
  const { data: recentCheckins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  // Get intake data
  let intakeData = null;
  try {
    const { data: fileData } = await db.storage
      .from('clients')
      .download(`intake_${client.lead_id}.json`);
    if (fileData) {
      const text = await fileData.text();
      intakeData = JSON.parse(text);
    }
  } catch (e) {
    // No intake form submitted; proceed with available data
  }

  // Get previous week's program
  const { data: prevProgram } = await db
    .from('programs')
    .select('workout_plan, nutrition_plan, notes')
    .eq('client_id', client_id)
    .eq('week_no', week_no - 1)
    .single();

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const systemPrompt = `You are "Program Architect", a world-class fitness program designer for FitnessByMaddy.
You create personalized weekly workout and nutrition plans based on client data.

RULES:
- Never recommend extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned or unregulated supplements
- Never promise specific weight loss timelines
- Base progressions on actual check-in data
- If client reports pain or injury, recommend deload and flag for trainer review
- Keep workout plans to 4-6 days per week with 1-2 rest days
- Nutrition plans should be practical and culturally appropriate

OUTPUT FORMAT (JSON only, no markdown):
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }
      ]}
    ],
    "rest_days": ["Sunday"],
    "cardio": "...",
    "notes": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["...", "..."] }
    ],
    "supplements": ["..."],
    "hydration": "...",
    "notes": "..."
  },
  "weekly_focus": "...",
  "safety_flags": []
}`;

  const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
${intakeData ? `- Age: ${intakeData.age || 'N/A'}
- Gender: ${intakeData.gender || 'N/A'}
- Height: ${intakeData.height || 'N/A'}
- Weight: ${intakeData.weight || 'N/A'}
- Goal: ${intakeData.goal || 'N/A'}
- Injuries: ${intakeData.injuries || 'None'}
- Diet preference: ${intakeData.diet_preference || 'No restriction'}
- Schedule: ${intakeData.workout_schedule || 'Flexible'}
- Experience: ${intakeData.experience_level || 'Intermediate'}
- Medical: ${intakeData.medical_conditions || 'None'}` : '- No intake form data available'}

RECENT CHECK-INS:
${recentCheckins && recentCheckins.length > 0
    ? recentCheckins.map(c => `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues=${c.issues || 'none'}`).join('\n')
    : 'No check-ins yet (first week)'}

${prevProgram ? `PREVIOUS WEEK PROGRAM:
Workout: ${JSON.stringify(prevProgram.workout_plan).substring(0, 500)}
Nutrition: ${JSON.stringify(prevProgram.nutrition_plan).substring(0, 500)}` : 'No previous program (first week)'}

Generate the Week ${week_no} plan as JSON.`;

  let programData;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = response.content[0].text;
    programData = JSON.parse(responseText);
  } catch (e) {
    return json(res, { error: 'program_generation_failed', detail: e.message }, 500);
  }

  // Safety check: halt if flagged
  if (programData.safety_flags && programData.safety_flags.length > 0) {
    await sendWhatsApp(process.env.MADDY_PHONE || '+917082478374', 'escalation_alert', {
      name: 'Maddy',
      templateParams: [
        client.name || 'Client',
        `Program safety flag Week ${week_no}: ${programData.safety_flags.join(', ')}`,
        new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      ],
    });

    await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: `HALTED - Safety flags: ${programData.safety_flags.join(', ')}`,
    });

    return json(res, { ok: false, action: 'halted_safety_flag', flags: programData.safety_flags });
  }

  // Generate PDF (HTML-based, rendered as clean document)
  const pdfHtml = generatePdfHtml(client, week_no, programData);
  const pdfPath = `${client_id}/week_${week_no}.html`;

  await db.storage.from('clients').upload(pdfPath, pdfHtml, {
    contentType: 'text/html',
    upsert: true,
  });

  const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
  const pdfUrl = urlData?.publicUrl || '';

  // Save to programs table
  const { data: program } = await db.from('programs').insert({
    client_id,
    week_no,
    pdf_url: pdfUrl,
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: programData.weekly_focus,
  }).select().single();

  // Send via WhatsApp
  await sendWhatsApp(client.phone, 'weekly_program', {
    name: client.name || 'there',
    templateParams: [
      client.name || 'there',
      String(week_no),
      programData.weekly_focus || 'Keep pushing!',
      pdfUrl,
    ],
  });

  // Update sent timestamp
  await db.from('programs').update({
    whatsapp_sent_at: new Date().toISOString(),
  }).eq('id', program.id);

  return json(res, { ok: true, program_id: program.id, pdf_url: pdfUrl });
};

function generatePdfHtml(client, weekNo, data) {
  const workout = data.workout_plan || {};
  const nutrition = data.nutrition_plan || {};

  const exerciseRows = (workout.days || []).map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr>
        <td>${ex.name}</td>
        <td>${ex.sets} × ${ex.reps}</td>
        <td>${ex.rest || '60s'}</td>
        <td>${ex.notes || ''}</td>
      </tr>`
    ).join('');
    return `<div class="day-block">
      <h3>${day.day} — ${day.focus}</h3>
      <table><thead><tr><th>Exercise</th><th>Sets × Reps</th><th>Rest</th><th>Notes</th></tr></thead>
      <tbody>${exercises}</tbody></table>
    </div>`;
  }).join('');

  const mealRows = (nutrition.meals || []).map(m =>
    `<div class="meal"><strong>${m.meal}:</strong> ${(m.options || []).join(' OR ')}</div>`
  ).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #111; color: #fff; padding: 40px 24px; }
  .header { text-align: center; padding: 40px 0; border-bottom: 2px solid #B8965A; margin-bottom: 32px; }
  .brand { font-family: 'Bebas Neue', sans-serif; font-size: 14px; letter-spacing: 6px; color: #B8965A; text-transform: uppercase; }
  h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; letter-spacing: 3px; color: #fff; margin: 16px 0; }
  h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; letter-spacing: 2px; color: #B8965A; margin: 32px 0 16px; border-bottom: 1px solid #333; padding-bottom: 8px; }
  h3 { font-family: 'Bebas Neue', sans-serif; font-size: 20px; letter-spacing: 1px; color: #D4AF7A; margin: 20px 0 12px; }
  .client-info { font-size: 14px; color: #888; }
  .focus { background: #1a1a1a; border-left: 4px solid #B8965A; padding: 16px 20px; margin: 24px 0; font-size: 15px; color: #ccc; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0 24px; }
  th { background: #1a1a1a; color: #B8965A; text-align: left; padding: 10px 12px; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; }
  td { padding: 10px 12px; border-bottom: 1px solid #222; font-size: 14px; color: #ddd; }
  .day-block { margin-bottom: 28px; }
  .macros { display: flex; gap: 24px; flex-wrap: wrap; margin: 16px 0; }
  .macro { background: #1a1a1a; padding: 16px 24px; text-align: center; flex: 1; min-width: 100px; }
  .macro-num { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; }
  .macro-label { font-size: 11px; color: #888; letter-spacing: 1px; text-transform: uppercase; margin-top: 4px; }
  .meal { padding: 10px 0; border-bottom: 1px solid #222; font-size: 14px; color: #ccc; }
  .footer { text-align: center; margin-top: 48px; padding-top: 24px; border-top: 1px solid #333; font-size: 12px; color: #555; }
  @media print { body { background: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">Fitness by Maddy</div>
    <h1>WEEK ${weekNo} PROGRAM</h1>
    <div class="client-info">${client.name || 'Client'} · ${client.program?.toUpperCase() || ''}</div>
  </div>

  ${data.weekly_focus ? `<div class="focus">${data.weekly_focus}</div>` : ''}

  <h2>WORKOUT PLAN</h2>
  ${exerciseRows}
  ${workout.cardio ? `<div class="focus"><strong>Cardio:</strong> ${workout.cardio}</div>` : ''}
  ${workout.rest_days ? `<p style="color:#888;margin:12px 0">Rest days: ${workout.rest_days.join(', ')}</p>` : ''}

  <h2>NUTRITION PLAN</h2>
  <div class="macros">
    <div class="macro"><div class="macro-num">${nutrition.calories || '—'}</div><div class="macro-label">Calories</div></div>
    <div class="macro"><div class="macro-num">${nutrition.protein_g || '—'}g</div><div class="macro-label">Protein</div></div>
    <div class="macro"><div class="macro-num">${nutrition.carbs_g || '—'}g</div><div class="macro-label">Carbs</div></div>
    <div class="macro"><div class="macro-num">${nutrition.fat_g || '—'}g</div><div class="macro-label">Fat</div></div>
  </div>
  ${mealRows}
  ${nutrition.supplements ? `<div class="focus"><strong>Supplements:</strong> ${nutrition.supplements.join(', ')}</div>` : ''}
  ${nutrition.hydration ? `<p style="color:#888;margin:12px 0"><strong>Hydration:</strong> ${nutrition.hydration}</p>` : ''}

  <div class="footer">
    © Fitness by Maddy · fitnessbymaddy.com · Generated ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
  </div>
</body>
</html>`;
}
