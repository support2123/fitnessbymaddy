const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const db = getSupabase();

  try {
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await db
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy, an online coaching brand run by Maddy (NASM certified, 10+ years experience). You design weekly workout and nutrition plans that are safe, effective, and tailored to each client.

RULES:
- Never prescribe extreme calorie deficits (never below 1200 kcal for women, 1500 for men)
- Never recommend banned or unproven supplements
- Never set unrealistic timelines (max 1kg/week fat loss)
- Always include rest days (min 1-2 per week)
- Adjust based on compliance score and energy levels from check-ins
- If client reports pain or medical issues, flag for human review instead of programming around it

OUTPUT FORMAT: Return valid JSON only with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [{ "name": "", "sets": 0, "reps": "", "rest": "", "notes": "" }] }
    ],
    "rest_days": ["Sunday"],
    "cardio": { "type": "", "duration": "", "frequency": "" }
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meals": [{ "meal": "Breakfast", "options": [""] }],
    "hydration": "",
    "supplements": [""]
  },
  "notes": "",
  "safety_flag": false,
  "safety_reason": ""
}`;

    const userPrompt = buildUserPrompt(client, recentCheckins, lastProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawOutput = response.content[0].text;
    let programData;
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('[generate-program] Failed to parse Claude output');
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    if (programData.safety_flag) {
      await escalateToMaddy('Program safety flag', {
        phone: client.phone,
        client_id,
        week_no,
        reason: programData.safety_reason,
      });
      return res.status(200).json({
        ok: true,
        action: 'flagged_for_review',
        reason: programData.safety_reason,
      });
    }

    const pdfHtml = generatePdfHtml(client, programData, week_no);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await db.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'text/html',
        upsert: true,
      });

    const { data: urlData } = db.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const { error: progErr } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: urlData.publicUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes,
    });

    if (progErr) {
      console.error('[generate-program] DB insert error:', progErr.message);
    }

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      urlData.publicUrl,
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ ok: true, pdf_url: urlData.publicUrl });
  } catch (err) {
    console.error('[generate-program] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildUserPrompt(client, checkins, lastProgram, weekNo) {
  const intake = client.intake_data || {};
  let prompt = `Generate Week ${weekNo} program for this client:

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Goal: ${intake.goal || 'fat loss + strength'}
- Experience: ${intake.experience_level || 'intermediate'}
- Injuries/Limitations: ${intake.injuries || 'none reported'}
- Diet Preference: ${intake.diet_preference || 'no restrictions'}
- Schedule: ${intake.schedule || '5 days/week'}
- Current Weight: ${intake.current_weight || 'not provided'}
- Target Weight: ${intake.target_weight || 'not provided'}
`;

  if (checkins && checkins.length > 0) {
    prompt += '\nRECENT CHECK-INS:\n';
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, Compliance ${c.compliance_score || '?'}/10, Energy ${c.energy || '?'}/10, Issues: ${c.issues || 'none'}\n`;
    }
  }

  if (lastProgram) {
    prompt += `\nLAST WEEK'S PROGRAM NOTES: ${lastProgram.notes || 'none'}\n`;
  }

  prompt += '\nGenerate the next week\'s program. Adjust intensity and volume based on check-in data. Return JSON only.';
  return prompt;
}

function generatePdfHtml(client, programData, weekNo) {
  const wp = programData.workout_plan;
  const np = programData.nutrition_plan;

  let workoutRows = '';
  if (wp.days) {
    for (const day of wp.days) {
      let exercises = '';
      if (day.exercises) {
        exercises = day.exercises
          .map(e => `<tr><td>${e.name}</td><td>${e.sets}x${e.reps}</td><td>${e.rest}</td><td>${e.notes || ''}</td></tr>`)
          .join('');
      }
      workoutRows += `
        <div class="day-block">
          <h3>${day.day} — ${day.focus}</h3>
          <table>
            <thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Notes</th></tr></thead>
            <tbody>${exercises}</tbody>
          </table>
        </div>`;
    }
  }

  let mealRows = '';
  if (np.meals) {
    mealRows = np.meals
      .map(m => `<div class="meal"><strong>${m.meal}:</strong> ${m.options.join(' / ')}</div>`)
      .join('');
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name}</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #f0f0f0; padding: 2rem; }
  .container { max-width: 800px; margin: 0 auto; }
  .header { text-align: center; padding: 2rem 0; border-bottom: 3px solid #B8965A; margin-bottom: 2rem; }
  .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 2.5rem; color: #B8965A; letter-spacing: 3px; }
  .header p { color: #999; margin-top: 0.5rem; }
  .section { margin-bottom: 2rem; }
  .section h2 { font-family: 'Bebas Neue', sans-serif; font-size: 1.8rem; color: #B8965A; margin-bottom: 1rem; letter-spacing: 2px; }
  .day-block { background: #222; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; border-left: 4px solid #B8965A; }
  .day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 1.3rem; color: #fff; margin-bottom: 0.8rem; letter-spacing: 1px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 0.5rem; color: #B8965A; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #333; }
  td { padding: 0.5rem; border-bottom: 1px solid #2a2a2a; font-size: 0.9rem; }
  .macros { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem; }
  .macro-box { background: #222; border-radius: 8px; padding: 1rem; text-align: center; border: 1px solid #333; }
  .macro-box .value { font-family: 'Bebas Neue', sans-serif; font-size: 2rem; color: #B8965A; }
  .macro-box .label { font-size: 0.75rem; color: #999; text-transform: uppercase; letter-spacing: 1px; }
  .meal { background: #222; border-radius: 8px; padding: 1rem; margin-bottom: 0.5rem; border-left: 4px solid #B8965A; }
  .notes { background: #222; border-radius: 8px; padding: 1.5rem; border-left: 4px solid #B8965A; font-style: italic; color: #ccc; }
  .footer { text-align: center; padding: 2rem 0; color: #666; font-size: 0.8rem; border-top: 1px solid #333; margin-top: 2rem; }
  @media (max-width: 600px) { .macros { grid-template-columns: repeat(2, 1fr); } body { padding: 1rem; } }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>FitnessByMaddy</h1>
    <p>Week ${weekNo} Program for ${client.name}</p>
  </div>

  <div class="section">
    <h2>Workout Plan</h2>
    ${workoutRows}
    ${wp.rest_days ? `<p style="color:#999;margin-top:1rem;">Rest Days: ${wp.rest_days.join(', ')}</p>` : ''}
    ${wp.cardio ? `<p style="color:#999;">Cardio: ${wp.cardio.type} — ${wp.cardio.duration}, ${wp.cardio.frequency}</p>` : ''}
  </div>

  <div class="section">
    <h2>Nutrition Plan</h2>
    <div class="macros">
      <div class="macro-box"><div class="value">${np.calories || '—'}</div><div class="label">Calories</div></div>
      <div class="macro-box"><div class="value">${np.protein_g || '—'}g</div><div class="label">Protein</div></div>
      <div class="macro-box"><div class="value">${np.carbs_g || '—'}g</div><div class="label">Carbs</div></div>
      <div class="macro-box"><div class="value">${np.fats_g || '—'}g</div><div class="label">Fats</div></div>
    </div>
    ${mealRows}
    ${np.hydration ? `<p style="color:#999;margin-top:1rem;">Hydration: ${np.hydration}</p>` : ''}
  </div>

  ${programData.notes ? `<div class="section"><h2>Coach Notes</h2><div class="notes">${programData.notes}</div></div>` : ''}

  <div class="footer">
    <p>FitnessByMaddy &bull; Custom Program &bull; Not for redistribution</p>
  </div>
</div>
</body>
</html>`;
}
