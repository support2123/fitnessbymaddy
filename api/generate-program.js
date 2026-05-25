const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'clenbuterol', 'dnp', 'dinitrophenol', 'ephedrine', 'sarms',
  'anabolic steroid', 'testosterone inject',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;

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

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevProgram } = await db
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified personal trainer and nutrition coach creating weekly programs for FitnessByMaddy clients.

RULES:
- Programs must be safe, evidence-based, and appropriate for the client's level
- Never recommend calories below 1200 for women or 1500 for men
- Never recommend banned or dangerous substances
- Never promise unrealistic timelines (max 1-1.5% body weight loss per week)
- Include proper warm-up and cool-down in every workout
- Account for client's reported injuries, energy levels, and compliance

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          {"name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "..."}
        ],
        "warmup": "...",
        "cooldown": "..."
      }
    ],
    "cardio": "...",
    "deload_notes": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meal_timing": ["..."],
    "hydration": "...",
    "supplements": ["..."],
    "notes": "..."
  },
  "weekly_note": "A short motivational + tactical note for the client"
}`;

    const checkinContext = recentCheckins && recentCheckins.length > 0
      ? recentCheckins.map(c => `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues: ${c.issues || 'none'}`).join('\n')
      : 'No previous check-ins available.';

    const prevProgramContext = prevProgram && prevProgram.length > 0
      ? `Previous week plan summary: ${JSON.stringify(prevProgram[0].workout_plan).slice(0, 500)}`
      : 'First week - no previous program.';

    const userPrompt = `Create Week ${week_no} program for this client:

Name: ${client.name || 'Client'}
Program: ${client.program}
Started: ${client.program_started_at}

Recent check-ins:
${checkinContext}

${prevProgramContext}

Design an appropriate Week ${week_no} program with progressive overload from the previous week. Adjust based on compliance, energy, and any issues reported.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;

    if (hasSafetyIssue(content)) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy(
        'Program safety flag',
        `Client: ${client.name || 'Unknown'} Week ${week_no}\nFlagged content detected in generated program. Review required before sending.`
      );

      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: { flagged: true, raw: content },
        nutrition_plan: { flagged: true },
        notes: 'FLAGGED: Safety review required before sending',
      });

      return res.status(200).json({ action: 'flagged_for_review' });
    }

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      parsed = { raw: content, parse_error: true };
    }

    const pdfContent = generatePDFHTML(client, week_no, parsed);
    const pdfBuffer = Buffer.from(pdfContent, 'utf-8');
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await db.storage.from('programs').upload(pdfPath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true,
    });

    const { data: urlData } = db.storage.from('programs').getPublicUrl(pdfPath);

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: urlData?.publicUrl || pdfPath,
      workout_plan: parsed.workout_plan || parsed,
      nutrition_plan: parsed.nutrition_plan || null,
      notes: parsed.weekly_note || null,
    }).select().single();

    const weeklyNote = parsed.weekly_note || `Your Week ${week_no} program is ready!`;
    await sendWhatsApp({
      phone: client.phone,
      body: `Week ${week_no} Program Ready!\n\n${weeklyNote}\n\nView your program: ${urlData?.publicUrl || 'Check your dashboard'}`,
      templateName: 'weekly_program',
      params: [client.name || 'there', String(week_no)],
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    return res.status(200).json({ action: 'generated', program_id: program.id });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generatePDFHTML(client, weekNo, plan) {
  const workout = plan.workout_plan || {};
  const nutrition = plan.nutrition_plan || {};
  const days = workout.days || [];

  const workoutRows = days.map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr>
        <td>${ex.name}</td>
        <td>${ex.sets} x ${ex.reps}</td>
        <td>${ex.rest || '-'}</td>
        <td>${ex.notes || ''}</td>
      </tr>`
    ).join('');

    return `
      <div class="day-block">
        <h3>${day.day} - ${day.focus}</h3>
        ${day.warmup ? `<p class="warmup">Warm-up: ${day.warmup}</p>` : ''}
        <table>
          <thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Notes</th></tr></thead>
          <tbody>${exercises}</tbody>
        </table>
        ${day.cooldown ? `<p class="cooldown">Cool-down: ${day.cooldown}</p>` : ''}
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program - ${client.name || 'Client'}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #FAF8F4; padding: 40px 20px; }
  .container { max-width: 800px; margin: 0 auto; }
  .header { text-align: center; padding: 40px 0; border-bottom: 2px solid #B8965A; margin-bottom: 40px; }
  .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #B8965A; letter-spacing: 4px; }
  .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #FAF8F4; letter-spacing: 2px; margin-top: 8px; }
  .header p { color: #888; font-size: 14px; margin-top: 8px; }
  .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 24px; color: #B8965A; letter-spacing: 2px; margin: 32px 0 16px; padding-bottom: 8px; border-bottom: 1px solid #333; }
  .day-block { background: #222; border-radius: 8px; padding: 24px; margin-bottom: 20px; }
  .day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 20px; color: #B8965A; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #888; padding: 8px; border-bottom: 1px solid #333; }
  td { padding: 10px 8px; border-bottom: 1px solid #2a2a2a; font-size: 14px; }
  .warmup, .cooldown { font-size: 13px; color: #aaa; margin: 8px 0; font-style: italic; }
  .nutrition-box { background: #222; border-radius: 8px; padding: 24px; }
  .macro-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 16px 0; }
  .macro-item { text-align: center; padding: 16px; background: #1a1a1a; border-radius: 8px; }
  .macro-value { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; }
  .macro-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  .note-box { background: linear-gradient(135deg, #2a2a1a, #1a1a1a); border: 1px solid #B8965A33; border-radius: 8px; padding: 24px; margin-top: 32px; }
  .note-box p { font-size: 15px; line-height: 1.6; color: #ccc; }
  .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #333; color: #555; font-size: 12px; }
  @media (max-width: 600px) { .macro-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <h2>WEEK ${weekNo} PROGRAM</h2>
    <p>${client.name || 'Client'} &middot; ${client.program} &middot; ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
  </div>

  <div class="section-title">WORKOUT PLAN</div>
  ${workoutRows}
  ${workout.cardio ? `<div class="day-block"><h3>Cardio</h3><p>${workout.cardio}</p></div>` : ''}

  <div class="section-title">NUTRITION PLAN</div>
  <div class="nutrition-box">
    <div class="macro-grid">
      <div class="macro-item"><div class="macro-value">${nutrition.calories || '-'}</div><div class="macro-label">Calories</div></div>
      <div class="macro-item"><div class="macro-value">${nutrition.protein_g || '-'}g</div><div class="macro-label">Protein</div></div>
      <div class="macro-item"><div class="macro-value">${nutrition.carbs_g || '-'}g</div><div class="macro-label">Carbs</div></div>
      <div class="macro-item"><div class="macro-value">${nutrition.fat_g || '-'}g</div><div class="macro-label">Fat</div></div>
    </div>
    ${nutrition.meal_timing ? `<p style="color:#aaa; font-size:13px; margin-top:12px"><strong>Meal Timing:</strong> ${Array.isArray(nutrition.meal_timing) ? nutrition.meal_timing.join(' | ') : nutrition.meal_timing}</p>` : ''}
    ${nutrition.hydration ? `<p style="color:#aaa; font-size:13px; margin-top:8px"><strong>Hydration:</strong> ${nutrition.hydration}</p>` : ''}
    ${nutrition.supplements ? `<p style="color:#aaa; font-size:13px; margin-top:8px"><strong>Supplements:</strong> ${Array.isArray(nutrition.supplements) ? nutrition.supplements.join(', ') : nutrition.supplements}</p>` : ''}
    ${nutrition.notes ? `<p style="color:#aaa; font-size:13px; margin-top:8px">${nutrition.notes}</p>` : ''}
  </div>

  ${plan.weekly_note ? `<div class="note-box"><p>${plan.weekly_note}</p></div>` : ''}

  <div class="footer">
    <p>FITNESS BY MADDY &middot; fitnessbymaddy.com</p>
  </div>
</div>
</body>
</html>`;
}
