const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body || {};

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: lead } = client.lead_id
      ? await db.from('leads').select('intake_data').eq('id', client.lead_id).single()
      : { data: null };

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await db
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified personal trainer and nutrition coach creating a weekly program for a fitness coaching client. You must output valid JSON only.

SAFETY RULES:
- Never recommend fewer than 1200 calories for women or 1500 calories for men
- Never recommend banned or dangerous supplements
- Never suggest more than 6 training days per week
- Include rest days
- If the client reports pain or injury, flag it and reduce intensity
- Be realistic about timelines - max 1-2 lbs fat loss per week

OUTPUT FORMAT (JSON only):
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Strength",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "15 min incline walk",
        "duration_min": 60
      }
    ],
    "rest_days": ["Sunday"],
    "weekly_notes": ""
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fat_g": 60,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"] }
    ],
    "hydration": "3L water daily",
    "supplements": ["Whey protein", "Creatine 5g"],
    "weekly_notes": ""
  },
  "coach_note": "Brief personalized message to the client",
  "safety_flag": false,
  "safety_reason": ""
}`;

    const userPrompt = buildClientPrompt(client, lead?.intake_data, recentCheckins, prevPrograms, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;

    let programData;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch (parseErr) {
      console.error('Failed to parse Claude response');
      return res.status(500).json({ error: 'Invalid program output from AI' });
    }

    if (programData.safety_flag) {
      const { notifyMaddy } = require('./lib/whatsapp');
      await notifyMaddy(
        'Program Safety Flag',
        `Client: ${client.name} (Week ${week_no})\nReason: ${programData.safety_reason}`
      );
      return res.status(200).json({
        ok: false,
        reason: 'safety_flagged',
        detail: programData.safety_reason
      });
    }

    const pdfHtml = generatePdfHtml(client, programData, week_no);

    const fileName = `clients/${client_id}/week_${week_no}.html`;
    await db.storage
      .from('client-files')
      .upload(fileName, pdfHtml, {
        contentType: 'text/html',
        upsert: true
      });

    const { data: fileUrl } = db.storage
      .from('client-files')
      .getPublicUrl(fileName);

    const { error: insertError } = await db
      .from('programs')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        generated_at: new Date().toISOString(),
        pdf_url: fileUrl.publicUrl,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.coach_note || ''
      });

    if (insertError) {
      console.error('Program insert error:', insertError.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    await sendWhatsApp(client.phone, 'weekly_program', {
      name: client.name,
      templateParams: [
        client.name || 'there',
        week_no.toString(),
        programData.coach_note || 'Your new week is ready!'
      ],
      media: { url: fileUrl.publicUrl, filename: `Week_${week_no}_Program.html` }
    }, true);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, week_no, pdf_url: fileUrl.publicUrl });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildClientPrompt(client, intakeData, checkins, prevPrograms, weekNo) {
  let prompt = `Create Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name}\n`;
  prompt += `Program: ${client.program}\n`;

  if (intakeData) {
    prompt += `\nIntake Data:\n`;
    if (intakeData.age) prompt += `- Age: ${intakeData.age}\n`;
    if (intakeData.gender) prompt += `- Gender: ${intakeData.gender}\n`;
    if (intakeData.goal) prompt += `- Goal: ${intakeData.goal}\n`;
    if (intakeData.injuries) prompt += `- Injuries/Limitations: ${intakeData.injuries}\n`;
    if (intakeData.diet_preference) prompt += `- Diet Preference: ${intakeData.diet_preference}\n`;
    if (intakeData.schedule) prompt += `- Schedule: ${intakeData.schedule}\n`;
    if (intakeData.experience_level) prompt += `- Experience: ${intakeData.experience_level}\n`;
    if (intakeData.current_weight) prompt += `- Current Weight: ${intakeData.current_weight}\n`;
    if (intakeData.target_weight) prompt += `- Target Weight: ${intakeData.target_weight}\n`;
  }

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent Check-ins:\n`;
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      prompt += `\n`;
    }
  }

  if (prevPrograms && prevPrograms.length > 0) {
    const prev = prevPrograms[0];
    prompt += `\nPrevious Week ${prev.week_no} had ${prev.workout_plan?.days?.length || 0} training days at ~${prev.nutrition_plan?.calories || 'unknown'} calories.\n`;
  }

  if (weekNo === 1) {
    prompt += `\nThis is Week 1 - start with moderate intensity to assess baseline fitness.\n`;
  } else if (weekNo >= 10) {
    prompt += `\nThis is Week ${weekNo} of 12 - peak phase, maintain intensity but watch for fatigue.\n`;
  }

  return prompt;
}

function generatePdfHtml(client, programData, weekNo) {
  const wp = programData.workout_plan || {};
  const np = programData.nutrition_plan || {};

  let workoutRows = '';
  if (wp.days) {
    for (const day of wp.days) {
      let exerciseList = '';
      if (day.exercises) {
        exerciseList = day.exercises.map(e =>
          `<tr><td>${e.name}</td><td>${e.sets} x ${e.reps}</td><td>${e.rest}</td></tr>`
        ).join('');
      }
      workoutRows += `
        <div class="day-block">
          <h3>${day.day} — ${day.focus}</h3>
          <table>
            <tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th></tr>
            ${exerciseList}
          </table>
          ${day.cardio ? `<p class="cardio">Cardio: ${day.cardio}</p>` : ''}
        </div>`;
    }
  }

  let mealRows = '';
  if (np.meals) {
    mealRows = np.meals.map(m =>
      `<div class="meal"><strong>${m.meal}:</strong> ${Array.isArray(m.options) ? m.options.join(' OR ') : m.options}</div>`
    ).join('');
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #fff; padding: 40px 20px; }
  .container { max-width: 800px; margin: 0 auto; }
  .header { text-align: center; padding: 40px 0; border-bottom: 2px solid #B8965A; margin-bottom: 30px; }
  .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #B8965A; letter-spacing: 4px; }
  .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #fff; margin-top: 8px; }
  .header p { color: #888; margin-top: 8px; }
  .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; letter-spacing: 2px; margin: 30px 0 15px; }
  .day-block { background: #222; border-radius: 8px; padding: 20px; margin-bottom: 16px; border-left: 3px solid #B8965A; }
  .day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #B8965A; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 8px; color: #B8965A; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #333; }
  td { padding: 8px; color: #ddd; font-size: 14px; border-bottom: 1px solid #2a2a2a; }
  .cardio { color: #B8965A; margin-top: 10px; font-style: italic; }
  .macros { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
  .macro-box { background: #222; border-radius: 8px; padding: 16px; text-align: center; border: 1px solid #333; }
  .macro-box .num { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #B8965A; }
  .macro-box .label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
  .meal { background: #222; padding: 12px 16px; border-radius: 6px; margin-bottom: 8px; color: #ddd; }
  .coach-note { background: linear-gradient(135deg, #2a2000, #1a1500); border: 1px solid #B8965A; border-radius: 8px; padding: 20px; margin-top: 30px; }
  .coach-note p { color: #ddd; line-height: 1.6; }
  .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #333; color: #555; font-size: 12px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <h2>WEEK ${weekNo} PROGRAM</h2>
    <p>${client.name} — ${client.program.replace('_', ' ').toUpperCase()}</p>
  </div>

  <div class="section-title">WORKOUT PLAN</div>
  ${workoutRows}
  ${wp.rest_days ? `<p style="color:#888;margin-top:12px;">Rest Days: ${wp.rest_days.join(', ')}</p>` : ''}

  <div class="section-title">NUTRITION PLAN</div>
  <div class="macros">
    <div class="macro-box"><div class="num">${np.calories || '—'}</div><div class="label">Calories</div></div>
    <div class="macro-box"><div class="num">${np.protein_g || '—'}g</div><div class="label">Protein</div></div>
    <div class="macro-box"><div class="num">${np.carbs_g || '—'}g</div><div class="label">Carbs</div></div>
    <div class="macro-box"><div class="num">${np.fat_g || '—'}g</div><div class="label">Fat</div></div>
  </div>
  ${mealRows}
  ${np.supplements ? `<p style="color:#888;margin-top:12px;">Supplements: ${np.supplements.join(', ')}</p>` : ''}
  ${np.hydration ? `<p style="color:#888;margin-top:8px;">Hydration: ${np.hydration}</p>` : ''}

  ${programData.coach_note ? `
  <div class="coach-note">
    <div class="section-title" style="margin-top:0;">FROM YOUR COACH</div>
    <p>${programData.coach_note}</p>
  </div>` : ''}

  <div class="footer">
    FITNESS BY MADDY &mdash; fitnessbymaddy.com<br>
    This program is personalized for ${client.name}. Do not redistribute.
  </div>
</div>
</body>
</html>`;
}
