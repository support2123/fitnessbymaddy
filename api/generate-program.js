const { getSupabase } = require('./lib/supabase');
const { sendTemplate, maskPhone } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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
    if (client.program !== '12wk') {
      return res.status(400).json({ error: 'Program generation is for 12-week clients only' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: leadData } = client.lead_id
      ? await db.from('leads').select('first_msg').eq('id', client.lead_id).single()
      : { data: null };

    let intakeProfile = {};
    try {
      if (leadData?.first_msg) intakeProfile = JSON.parse(leadData.first_msg);
    } catch (_) {}

    const anthropic = new Anthropic();

    const systemPrompt = `You are Maddy's program architect — an expert fitness coach designing weekly training and nutrition plans for real clients. You are NASM-certified and evidence-based.

RULES:
- Never prescribe extreme calorie deficits below 1200kcal for women or 1500kcal for men
- Never recommend banned or unregulated supplements
- Never promise specific weight loss timelines
- Adjust based on check-in data: if compliance is low, simplify; if energy is low, increase carbs/rest
- Programs must be progressive: build on previous weeks
- Include warm-up and cool-down in every workout
- Format output as JSON with workout_plan and nutrition_plan keys`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name}
- Program: 12-Week Custom Flagship
- Started: ${client.program_started_at}
${intakeProfile.goal ? `- Goal: ${intakeProfile.goal}` : ''}
${intakeProfile.injuries ? `- Injuries/Limitations: ${intakeProfile.injuries}` : ''}
${intakeProfile.diet_preference ? `- Diet Preference: ${intakeProfile.diet_preference}` : ''}
${intakeProfile.available_equipment ? `- Equipment: ${intakeProfile.available_equipment}` : ''}
${intakeProfile.workout_experience ? `- Experience: ${intakeProfile.workout_experience}` : ''}

RECENT CHECK-INS:
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map((c) => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n')
  : 'No previous check-ins available (this is week 1)'}

Output a JSON object with:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..."}], "warmup": "...", "cooldown": "..." }
    ],
    "rest_days": ["Sunday"],
    "notes": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "...",
    "notes": "..."
  },
  "week_focus": "...",
  "coach_note": "..."
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = response.content[0].text;

    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const safetyFlags = checkSafety(programData);
    if (safetyFlags.length > 0) {
      const { escalateToMaddy } = require('./lib/escalation');
      await escalateToMaddy(
        'Program safety flag',
        `Client: ${maskPhone(client.phone)} | Week ${week_no} | Flags: ${safetyFlags.join(', ')}`
      );
      return res.status(200).json({
        success: false,
        reason: 'safety_flagged',
        flags: safetyFlags,
      });
    }

    const pdfHtml = generateProgramPdfHtml(client, week_no, programData);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');
    const pdfPath = `clients/${client.id}/week_${week_no}.html`;

    await db.storage.from('clients').upload(pdfPath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true,
    });

    const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { error: progErr } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_note || programData.week_focus,
    });

    if (progErr) {
      console.error('Program insert error:', progErr.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      programData.week_focus || `Week ${week_no} program ready`,
      pdfUrl,
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({
      success: true,
      client_id,
      week_no,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function checkSafety(programData) {
  const flags = [];
  const np = programData.nutrition_plan;
  if (np) {
    if (np.calories && np.calories < 1200) flags.push('Calories below 1200');
    if (np.supplements) {
      const banned = ['ephedra', 'dnp', 'clenbuterol', 'sarms', 'steroids', 'hgh'];
      for (const s of np.supplements) {
        if (banned.some((b) => s.toLowerCase().includes(b))) {
          flags.push(`Banned supplement: ${s}`);
        }
      }
    }
  }
  if (programData.coach_note && /guarantee|promise.*result|100%/.test(programData.coach_note)) {
    flags.push('Over-promising language');
  }
  return flags;
}

function generateProgramPdfHtml(client, weekNo, data) {
  const wp = data.workout_plan || {};
  const np = data.nutrition_plan || {};

  let workoutRows = '';
  if (wp.days) {
    for (const day of wp.days) {
      let exerciseList = '';
      if (day.exercises) {
        exerciseList = day.exercises
          .map((e) => `<li><strong>${e.name}</strong> — ${e.sets}×${e.reps} (Rest: ${e.rest || '60s'})${e.notes ? ` <em>${e.notes}</em>` : ''}</li>`)
          .join('');
      }
      workoutRows += `
        <div class="day-block">
          <h3>${day.day} — ${day.focus}</h3>
          ${day.warmup ? `<p class="detail">Warm-up: ${day.warmup}</p>` : ''}
          <ul>${exerciseList}</ul>
          ${day.cooldown ? `<p class="detail">Cool-down: ${day.cooldown}</p>` : ''}
        </div>`;
    }
  }

  let mealRows = '';
  if (np.meals) {
    for (const m of np.meals) {
      mealRows += `<div class="meal"><strong>${m.meal}:</strong> ${(m.options || []).join(' / ')}</div>`;
    }
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Week ${weekNo} Program — ${client.name}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'DM Sans', sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 40px 24px; }
    .container { max-width: 700px; margin: 0 auto; }
    .header { text-align: center; border-bottom: 2px solid #B8965A; padding-bottom: 32px; margin-bottom: 40px; }
    .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #B8965A; letter-spacing: 4px; }
    .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #fff; letter-spacing: 2px; margin-top: 8px; }
    .header p { color: #888; font-size: 14px; margin-top: 8px; }
    .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; letter-spacing: 3px; margin: 40px 0 20px; border-left: 4px solid #B8965A; padding-left: 16px; }
    .day-block { background: #141414; border: 1px solid #222; border-radius: 8px; padding: 24px; margin-bottom: 16px; }
    .day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #fff; letter-spacing: 1px; margin-bottom: 12px; }
    .day-block ul { list-style: none; }
    .day-block li { padding: 8px 0; border-bottom: 1px solid #1a1a1a; font-size: 14px; color: #ccc; }
    .day-block li strong { color: #fff; }
    .day-block li em { color: #B8965A; font-style: normal; font-size: 12px; }
    .detail { font-size: 13px; color: #888; margin: 8px 0; }
    .macros { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
    .macro-box { background: #141414; border: 1px solid #222; border-radius: 8px; padding: 16px; text-align: center; }
    .macro-box .num { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; }
    .macro-box .label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
    .meal { background: #141414; border: 1px solid #222; border-radius: 8px; padding: 16px; margin-bottom: 8px; font-size: 14px; color: #ccc; }
    .meal strong { color: #fff; }
    .coach-note { background: linear-gradient(135deg, #1a1508, #141414); border: 1px solid #B8965A33; border-radius: 8px; padding: 24px; margin-top: 32px; font-size: 14px; color: #ccc; line-height: 1.8; }
    .coach-note strong { color: #B8965A; }
    .footer { text-align: center; margin-top: 48px; padding-top: 24px; border-top: 1px solid #222; color: #555; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>FITNESS BY MADDY</h1>
      <h2>WEEK ${weekNo} PROGRAM</h2>
      <p>${client.name} &middot; 12-Week Custom Flagship</p>
    </div>

    ${data.week_focus ? `<p style="text-align:center;color:#B8965A;font-size:16px;margin-bottom:32px;"><strong>This Week's Focus:</strong> ${data.week_focus}</p>` : ''}

    <div class="section-title">WORKOUT PLAN</div>
    ${workoutRows}
    ${wp.rest_days ? `<p class="detail" style="margin-top:12px;">Rest Days: ${wp.rest_days.join(', ')}</p>` : ''}
    ${wp.notes ? `<p class="detail">${wp.notes}</p>` : ''}

    <div class="section-title">NUTRITION PLAN</div>
    <div class="macros">
      <div class="macro-box"><div class="num">${np.calories || '—'}</div><div class="label">Calories</div></div>
      <div class="macro-box"><div class="num">${np.protein_g || '—'}g</div><div class="label">Protein</div></div>
      <div class="macro-box"><div class="num">${np.carbs_g || '—'}g</div><div class="label">Carbs</div></div>
      <div class="macro-box"><div class="num">${np.fat_g || '—'}g</div><div class="label">Fat</div></div>
    </div>
    ${mealRows}
    ${np.hydration ? `<p class="detail" style="margin-top:12px;">Hydration: ${np.hydration}</p>` : ''}
    ${np.supplements ? `<p class="detail">Supplements: ${np.supplements.join(', ')}</p>` : ''}
    ${np.notes ? `<p class="detail">${np.notes}</p>` : ''}

    ${data.coach_note ? `<div class="coach-note"><strong>Coach Maddy's Note:</strong><br>${data.coach_note}</div>` : ''}

    <div class="footer">
      FITNESS BY MADDY &middot; fitnessbymaddy.com &middot; NASM Certified<br>
      This program is personalised for ${client.name}. Do not redistribute.
    </div>
  </div>
</body>
</html>`;
}
