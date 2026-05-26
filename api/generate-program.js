const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/masking');

const UNSAFE_PATTERNS = [
  /under\s*800\s*cal/i, /500\s*cal/i, /extreme\s*fast/i,
  /clenbuterol/i, /dnp/i, /ephedra/i, /steroid/i,
  /lose\s*\d{2,}\s*(kg|lb|pound).*week/i
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client || client.status !== 'active') {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeForm } = await db
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .single();

    const prompt = buildPrompt(client, recentCheckins || [], intakeForm, week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!claudeRes.ok) {
      const errData = await claudeRes.text();
      console.error('Claude API error:', errData);
      return res.status(502).json({ error: 'AI generation failed' });
    }

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content?.[0]?.text || '';

    if (containsUnsafeContent(responseText)) {
      await escalateToMaddy(
        'Unsafe content in generated program',
        client.phone,
        `Week ${week_no} program flagged for review`
      );
      return res.status(200).json({ status: 'flagged', reason: 'unsafe_content' });
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const parsed = JSON.parse(responseText);
      workoutPlan = parsed.workout_plan || parsed.workout || {};
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition || {};
      notes = parsed.notes || parsed.coach_notes || '';
    } catch {
      workoutPlan = { raw: responseText };
      nutritionPlan = {};
      notes = '';
    }

    const pdfContent = generatePdfHtml(client, week_no, workoutPlan, nutritionPlan, notes);
    const pdfBuffer = Buffer.from(pdfContent, 'utf-8');
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await db.storage.from('client-files').upload(pdfPath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true
    });

    const { data: urlData } = db.storage
      .from('client-files')
      .getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes: notes || null
    });

    const contextNote =
      recentCheckins?.[0]
        ? `Based on your Week ${recentCheckins[0].week_no} check-in — let's keep the momentum going!`
        : `Your personalized Week ${week_no} plan is ready!`;

    await sendWhatsApp(
      client.phone,
      `${contextNote}\n\nYour Week ${week_no} program: ${pdfUrl}\n\nQuestions? Just reply here 💪`,
      null,
      true
    );

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    console.log(`Program generated: client=${client_id} week=${week_no} (${maskPhone(client.phone)})`);
    return res.status(200).json({ status: 'ok', week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildPrompt(client, checkins, intake, weekNo) {
  const profile = [
    `Client: ${client.name || 'Unknown'}`,
    `Program: ${client.program}`,
    `Week: ${weekNo} of 12`,
    intake?.goal ? `Goal: ${intake.goal}` : '',
    intake?.injuries ? `Injuries/limitations: ${intake.injuries}` : '',
    intake?.diet_pref ? `Diet preference: ${intake.diet_pref}` : '',
    intake?.schedule ? `Schedule: ${intake.schedule}` : '',
    intake?.current_weight ? `Starting weight: ${intake.current_weight}` : '',
    intake?.experience_level ? `Experience: ${intake.experience_level}` : ''
  ].filter(Boolean).join('\n');

  const checkinHistory = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight || '?'}, waist=${c.waist || '?'}, ` +
    `compliance=${c.compliance_score || '?'}/10, energy=${c.energy || '?'}/10` +
    (c.issues ? `, issues: ${c.issues}` : '') +
    (c.next_week_focus ? `, focus: ${c.next_week_focus}` : '')
  ).join('\n');

  return `You are a NASM-certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT PROFILE:
${profile}

RECENT CHECK-INS:
${checkinHistory || 'No previous check-ins'}

INSTRUCTIONS:
- Create a detailed Week ${weekNo} workout plan (5-6 days, with rest days)
- Create a nutrition plan with macro targets and meal suggestions
- Adapt based on check-in data (compliance, energy, issues)
- Be progressive — increase volume/intensity appropriately
- Include warm-up and cool-down guidance
- Never recommend extreme calorie restrictions (below 1200 cal for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Include coach notes with 2-3 key focus areas for the week

OUTPUT FORMAT: Return valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ], "warmup": "", "cooldown": "" }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 250,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"] }
    ],
    "hydration": "",
    "supplements": []
  },
  "notes": "Coach notes here"
}`;
}

function containsUnsafeContent(text) {
  return UNSAFE_PATTERNS.some(pattern => pattern.test(text));
}

function generatePdfHtml(client, weekNo, workout, nutrition, notes) {
  const exerciseRows = (workout.days || []).map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr>
        <td>${ex.name || ''}</td>
        <td>${ex.sets || ''} x ${ex.reps || ''}</td>
        <td>${ex.rest || ''}</td>
        <td>${ex.notes || ''}</td>
      </tr>`
    ).join('');

    return `
      <div class="day-block">
        <h3>${day.day || ''} — ${day.focus || ''}</h3>
        ${day.warmup ? `<p class="warmup">Warm-up: ${day.warmup}</p>` : ''}
        <table>
          <thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Notes</th></tr></thead>
          <tbody>${exercises}</tbody>
        </table>
        ${day.cooldown ? `<p class="cooldown">Cool-down: ${day.cooldown}</p>` : ''}
      </div>`;
  }).join('');

  const mealRows = (nutrition.meals || []).map(m =>
    `<div class="meal">
      <strong>${m.meal || ''}:</strong> ${(m.options || []).join(' | ')}
    </div>`
  ).join('');

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #fff; padding: 40px; }
  .header { text-align: center; padding: 40px 20px; border-bottom: 2px solid #B8965A; margin-bottom: 40px; }
  .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #B8965A; letter-spacing: 4px; }
  .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #fff; letter-spacing: 2px; margin-top: 8px; }
  .header p { color: #888; font-size: 14px; margin-top: 8px; }
  .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 24px; color: #B8965A; letter-spacing: 2px; margin: 32px 0 16px; border-bottom: 1px solid #333; padding-bottom: 8px; }
  .day-block { background: #222; border-radius: 8px; padding: 24px; margin-bottom: 20px; }
  .day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 20px; color: #B8965A; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #888; padding: 8px; border-bottom: 1px solid #333; }
  td { padding: 8px; font-size: 14px; border-bottom: 1px solid #2a2a2a; }
  .warmup, .cooldown { font-size: 13px; color: #aaa; margin: 8px 0; font-style: italic; }
  .macros { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 16px 0; }
  .macro-box { background: #222; border-radius: 8px; padding: 20px; text-align: center; }
  .macro-box .num { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #B8965A; }
  .macro-box .label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  .meal { background: #222; border-radius: 8px; padding: 16px; margin-bottom: 8px; font-size: 14px; }
  .notes { background: #222; border-radius: 8px; padding: 24px; font-size: 14px; line-height: 1.8; color: #ccc; }
  .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #333; color: #555; font-size: 12px; }
  @media print { body { background: white; color: #333; } .day-block, .macro-box, .meal, .notes { background: #f5f5f5; } .header h1, .day-block h3, .section-title, .macro-box .num { color: #8B6914; } }
</style>
</head><body>
<div class="header">
  <h1>FITNESS BY MADDY</h1>
  <h2>WEEK ${weekNo} PROGRAM</h2>
  <p>${client.name || ''} | ${client.program?.toUpperCase() || ''}</p>
</div>

<div class="section-title">WORKOUT PLAN</div>
${exerciseRows || '<p>Workout plan details coming soon.</p>'}

<div class="section-title">NUTRITION PLAN</div>
<div class="macros">
  <div class="macro-box"><div class="num">${nutrition.calories || '—'}</div><div class="label">Calories</div></div>
  <div class="macro-box"><div class="num">${nutrition.protein_g || '—'}g</div><div class="label">Protein</div></div>
  <div class="macro-box"><div class="num">${nutrition.carbs_g || '—'}g</div><div class="label">Carbs</div></div>
  <div class="macro-box"><div class="num">${nutrition.fat_g || '—'}g</div><div class="label">Fat</div></div>
</div>
${mealRows || ''}
${nutrition.hydration ? `<p style="color:#888;margin-top:12px;">Hydration: ${nutrition.hydration}</p>` : ''}

${notes ? `<div class="section-title">COACH NOTES</div><div class="notes">${notes}</div>` : ''}

<div class="footer">Fitness by Maddy &copy; ${new Date().getFullYear()} | This program is personalised — do not share.</div>
</body></html>`;
}
