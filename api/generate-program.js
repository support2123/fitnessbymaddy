const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { sendText } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalation');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /\b(dnp|clenbuterol|sarms|steroids|tren|anavar)\b/i,
  /lose\s*(10|15|20)\+?\s*(kg|lb|pound).*?(week|1\s*week)/i
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
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

    const { data: intakeMsg } = await db
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .like('body', 'INTAKE_FORM:%')
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    let intakeData = null;
    if (intakeMsg && intakeMsg.body) {
      try {
        intakeData = JSON.parse(intakeMsg.body.replace('INTAKE_FORM: ', ''));
      } catch (e) { /* ignore parse error */ }
    }

    const anthropic = new Anthropic();

    const systemPrompt = `You are an expert fitness coach and nutritionist creating a weekly program for a client.
Output valid JSON with two keys: "workout_plan" and "nutrition_plan".

workout_plan: an object with keys for each training day (e.g. "day1_push", "day2_pull", etc).
Each day has an "exercises" array with objects: { name, sets, reps, rest_seconds, notes }.

nutrition_plan: an object with keys: "daily_calories", "protein_g", "carbs_g", "fat_g",
"meal_plan" (array of { meal_name, foods, approximate_calories }).

Rules:
- Never recommend fewer than 1400 calories/day for women or 1600 for men
- Never recommend banned substances, SARMs, or steroids
- Never promise specific weight loss timelines
- Base the plan on the client's check-in data and progression
- If this is week 1, create a foundational program based on intake data
- For subsequent weeks, progressively adjust based on compliance and results`;

    const userPrompt = buildUserPrompt(client, intakeData, recentCheckins, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;

    for (const pattern of RISKY_PATTERNS) {
      if (pattern.test(rawText)) {
        await escalateToMaddy('Risky content in generated program', client.phone, rawText.slice(0, 300));
        return res.json({ success: false, reason: 'flagged_for_review' });
      }
    }

    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const pdfHtml = renderProgramPdf(client, week_no, parsed);

    const fileName = `week_${week_no}.html`;
    const storagePath = `${client.folder_url || 'clients/' + client_id}/${fileName}`;

    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(storagePath, Buffer.from(pdfHtml), {
        contentType: 'text/html',
        upsert: true
      });

    const pdfUrl = uploadError ? null : `${process.env.SUPABASE_URL}/storage/v1/object/public/programs/${storagePath}`;

    const { data: program, error: insertError } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan || {},
      nutrition_plan: parsed.nutrition_plan || {},
      notes: `Generated for week ${week_no}`
    }).select().single();

    if (insertError) throw insertError;

    if (pdfUrl) {
      const msg = `Your Week ${week_no} program is ready! 💪\n\n` +
                  `View it here: ${pdfUrl}\n\n` +
                  `Focus this week: progressive overload and hitting your protein target.`;
      await sendText(client.phone, msg);

      await db.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);
    }

    return res.json({ success: true, program_id: program.id, pdf_url: pdfUrl });

  } catch (err) {
    console.error('Program gen error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildUserPrompt(client, intake, checkins, weekNo) {
  let prompt = `Create Week ${weekNo} program for client:\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${client.program}\n`;

  if (intake) {
    prompt += `\nIntake Data:\n`;
    if (intake.age) prompt += `Age: ${intake.age}\n`;
    if (intake.gender) prompt += `Gender: ${intake.gender}\n`;
    if (intake.goal) prompt += `Goal: ${intake.goal}\n`;
    if (intake.current_weight) prompt += `Current Weight: ${intake.current_weight}\n`;
    if (intake.target_weight) prompt += `Target Weight: ${intake.target_weight}\n`;
    if (intake.height) prompt += `Height: ${intake.height}\n`;
    if (intake.injuries) prompt += `Injuries/Limitations: ${intake.injuries}\n`;
    if (intake.diet_pref) prompt += `Diet Preference: ${intake.diet_pref}\n`;
    if (intake.schedule) prompt += `Schedule: ${intake.schedule}\n`;
    if (intake.experience_level) prompt += `Experience: ${intake.experience_level}\n`;
  }

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent Check-ins:\n`;
    for (const c of checkins) {
      prompt += `Week ${c.week_no}: weight=${c.weight || '?'}, waist=${c.waist || '?'}, ` +
                `compliance=${c.compliance_score || '?'}/10, energy=${c.energy || '?'}/10`;
      if (c.issues) prompt += `, issues: "${c.issues}"`;
      prompt += '\n';
    }
  }

  prompt += '\nReturn ONLY the JSON object with workout_plan and nutrition_plan.';
  return prompt;
}

function renderProgramPdf(client, weekNo, data) {
  const workout = data.workout_plan || {};
  const nutrition = data.nutrition_plan || {};

  let workoutHtml = '';
  for (const [day, info] of Object.entries(workout)) {
    const dayName = day.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    let exercises = '';
    const exList = info.exercises || info || [];
    const arr = Array.isArray(exList) ? exList : [];
    for (const ex of arr) {
      exercises += `<tr>
        <td>${ex.name || ''}</td>
        <td>${ex.sets || ''} x ${ex.reps || ''}</td>
        <td>${ex.rest_seconds || 60}s</td>
        <td>${ex.notes || ''}</td>
      </tr>`;
    }
    workoutHtml += `<div class="day-block">
      <h3>${dayName}</h3>
      <table><thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Notes</th></tr></thead>
      <tbody>${exercises}</tbody></table>
    </div>`;
  }

  let mealHtml = '';
  const meals = nutrition.meal_plan || [];
  for (const m of meals) {
    const foods = Array.isArray(m.foods) ? m.foods.join(', ') : (m.foods || '');
    mealHtml += `<div class="meal">
      <strong>${m.meal_name || ''}</strong> (~${m.approximate_calories || '?'} cal)<br>
      ${foods}
    </div>`;
  }

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Week ${weekNo} Program - ${client.name || 'Client'}</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#111;color:#fff;padding:24px;max-width:800px;margin:0 auto}
h1,h2,h3{font-family:'Bebas Neue',sans-serif;letter-spacing:2px}
h1{font-size:36px;color:#B8965A;margin-bottom:4px}
h2{font-size:24px;color:#B8965A;margin:32px 0 16px;border-bottom:1px solid #333;padding-bottom:8px}
h3{font-size:18px;color:#fff;margin-bottom:12px}
.header{border-bottom:2px solid #B8965A;padding-bottom:16px;margin-bottom:24px}
.subtitle{color:#999;font-size:14px}
.day-block{background:#1a1a1a;border:1px solid #333;border-radius:4px;padding:20px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;color:#B8965A;padding:8px 12px;border-bottom:1px solid #333;font-size:11px;letter-spacing:1px;text-transform:uppercase}
td{padding:8px 12px;border-bottom:1px solid #222;color:#ccc}
.macros{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
.macro-box{background:#1a1a1a;border:1px solid #333;border-radius:4px;padding:16px;text-align:center}
.macro-val{font-family:'Bebas Neue',sans-serif;font-size:28px;color:#B8965A}
.macro-label{font-size:11px;color:#999;text-transform:uppercase;letter-spacing:1px}
.meal{background:#1a1a1a;border:1px solid #333;border-radius:4px;padding:16px;margin-bottom:12px;font-size:14px;color:#ccc}
.meal strong{color:#fff}
.footer{margin-top:40px;text-align:center;color:#666;font-size:12px;border-top:1px solid #333;padding-top:16px}
</style></head><body>
<div class="header">
  <h1>WEEK ${weekNo} PROGRAM</h1>
  <div class="subtitle">${client.name || 'Client'} · ${client.program || '12wk'} · Fitness by Maddy</div>
</div>
<h2>NUTRITION</h2>
<div class="macros">
  <div class="macro-box"><div class="macro-val">${nutrition.daily_calories || '—'}</div><div class="macro-label">Calories</div></div>
  <div class="macro-box"><div class="macro-val">${nutrition.protein_g || '—'}g</div><div class="macro-label">Protein</div></div>
  <div class="macro-box"><div class="macro-val">${nutrition.carbs_g || '—'}g</div><div class="macro-label">Carbs</div></div>
  <div class="macro-box"><div class="macro-val">${nutrition.fat_g || '—'}g</div><div class="macro-label">Fat</div></div>
</div>
${mealHtml}
<h2>TRAINING</h2>
${workoutHtml}
<div class="footer">Fitness by Maddy · fitnessbymaddy.com · Program generated for ${client.name || 'Client'}</div>
</body></html>`;
}
