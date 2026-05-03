const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { isHinglish } = require('./lib/market');

const SYSTEM_PROMPT = `You are Maddy's AI program architect for FitnessByMaddy. You create weekly workout and nutrition plans for online coaching clients.

RULES:
- Plans must be safe, evidence-based, and appropriate for the client's level
- NEVER prescribe extreme calorie deficits (below 1200 kcal for women, 1500 kcal for men)
- NEVER recommend banned substances or supplements that require medical supervision
- NEVER set unrealistic timelines (e.g., "lose 10kg in 2 weeks")
- Base progressive overload on the client's check-in data
- Adjust volume/intensity based on compliance score and energy levels
- If the client reports pain or injury, reduce intensity and flag for review
- Include warm-up and cool-down in every workout
- Nutrition should be practical and culturally appropriate (Indian diet options for IN market)

OUTPUT FORMAT (JSON):
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..." }
        ],
        "warmup": "...",
        "cooldown": "..."
      }
    ],
    "weekly_notes": "..."
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["..."], "macros": "..." }
    ],
    "supplements": ["..."],
    "hydration": "...",
    "weekly_notes": "..."
  },
  "coach_notes": "...",
  "safety_flags": []
}

If anything is risky, add it to safety_flags array and the system will hold for human review.`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeForm } = await db
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const { data: previousPrograms } = await db
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const clientContext = {
      name: client.name,
      program: client.program,
      week_number: week_no,
      total_weeks: client.program === '12wk' ? 12 : 6,
      intake: intakeForm || {},
      recent_checkins: checkins || [],
      previous_program: previousPrograms?.[0] || null,
      market: isHinglish(client.phone) ? 'IN' : 'GLOBAL',
    };

    const userPrompt = `Create Week ${week_no} program for this client:

CLIENT PROFILE:
${JSON.stringify(clientContext, null, 2)}

Generate a complete, progressive workout and nutrition plan for this week. Consider their check-in data for adjustments.`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content?.[0]?.text || '';

    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Invalid program format from AI' });
    }

    if (!programData) {
      return res.status(500).json({ error: 'No program data generated' });
    }

    if (programData.safety_flags && programData.safety_flags.length > 0) {
      const { notifyMaddy } = require('./lib/whatsapp');
      const { maskPhone } = require('./lib/market');
      await notifyMaddy(
        `Safety flag — ${client.name} Week ${week_no}`,
        `Program generation flagged:\n${programData.safety_flags.join('\n')}\nClient: ${maskPhone(client.phone)}`
      );
      await db.from('programs').insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: `HELD FOR REVIEW: ${programData.safety_flags.join(', ')}`,
      });
      return res.json({ action: 'held_for_review', safety_flags: programData.safety_flags });
    }

    const pdfHtml = generatePdfHtml(client, week_no, programData);
    const pdfBuffer = Buffer.from(pdfHtml);

    const filePath = `clients/${client_id}/week_${week_no}.html`;
    await db.storage.from('programs').upload(filePath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true,
    });

    const { data: publicUrl } = db.storage.from('programs').getPublicUrl(filePath);

    const { error: insertError } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: publicUrl?.publicUrl || filePath,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_notes || '',
      whatsapp_sent_at: new Date().toISOString(),
    });

    if (insertError) {
      console.error('Program insert error:', insertError.message);
    }

    const hinglish = isHinglish(client.phone);
    await sendWhatsApp(
      client.phone,
      hinglish ? 'program_ready_hi' : 'program_ready_en',
      [client.name || 'Champion', String(week_no)],
      publicUrl?.publicUrl
    );

    return res.json({
      action: 'generated',
      week_no,
      url: publicUrl?.publicUrl,
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generatePdfHtml(client, weekNo, program) {
  const workout = program.workout_plan || {};
  const nutrition = program.nutrition_plan || {};

  const workoutRows = (workout.days || []).map(day => {
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
        <h3>${day.day} — ${day.focus}</h3>
        <p class="warmup"><strong>Warm-up:</strong> ${day.warmup || 'General 5-min warm-up'}</p>
        <table>
          <thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Notes</th></tr></thead>
          <tbody>${exercises}</tbody>
        </table>
        <p class="cooldown"><strong>Cool-down:</strong> ${day.cooldown || '5-min stretching'}</p>
      </div>`;
  }).join('');

  const mealRows = (nutrition.meals || []).map(meal =>
    `<div class="meal-block">
      <h4>${meal.meal}</h4>
      <ul>${(meal.options || []).map(o => `<li>${o}</li>`).join('')}</ul>
      <p class="macros">${meal.macros || ''}</p>
    </div>`
  ).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #0a0a0a; color: #fff; padding: 40px 24px; }
  .header { text-align: center; margin-bottom: 48px; border-bottom: 2px solid #B8965A; padding-bottom: 32px; }
  .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #B8965A; letter-spacing: 4px; }
  .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #fff; letter-spacing: 2px; margin-top: 8px; }
  .header p { color: #888; font-size: 14px; margin-top: 8px; }
  .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; letter-spacing: 3px; margin: 40px 0 20px; border-left: 4px solid #B8965A; padding-left: 16px; }
  .day-block { background: #1a1a1a; border-radius: 8px; padding: 24px; margin-bottom: 24px; border: 1px solid #333; }
  .day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #D4AF7A; letter-spacing: 2px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th { text-align: left; padding: 8px 12px; background: #B8965A; color: #0a0a0a; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
  td { padding: 10px 12px; border-bottom: 1px solid #333; font-size: 14px; color: #ccc; }
  .warmup, .cooldown { font-size: 13px; color: #888; margin: 8px 0; }
  .nutrition-summary { background: #1a1a1a; border-radius: 8px; padding: 24px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; border: 1px solid #333; }
  .macro-box { text-align: center; }
  .macro-box .value { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #B8965A; }
  .macro-box .label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
  .meal-block { background: #1a1a1a; border-radius: 8px; padding: 20px; margin-bottom: 16px; border: 1px solid #333; }
  .meal-block h4 { font-family: 'Bebas Neue', sans-serif; font-size: 18px; color: #D4AF7A; margin-bottom: 8px; }
  .meal-block ul { list-style: none; }
  .meal-block li { padding: 4px 0; color: #ccc; font-size: 14px; }
  .meal-block li::before { content: '→ '; color: #B8965A; }
  .macros { font-size: 12px; color: #888; margin-top: 8px; }
  .coach-notes { background: linear-gradient(135deg, #1a1510, #1a1a1a); border: 1px solid #B8965A; border-radius: 8px; padding: 24px; margin-top: 32px; }
  .coach-notes h3 { font-family: 'Bebas Neue', sans-serif; color: #B8965A; margin-bottom: 12px; }
  .coach-notes p { color: #ccc; font-size: 14px; line-height: 1.7; }
  .footer { text-align: center; margin-top: 48px; padding-top: 24px; border-top: 1px solid #333; }
  .footer p { color: #555; font-size: 12px; }
  @media (max-width: 600px) { .nutrition-summary { grid-template-columns: repeat(2, 1fr); } body { padding: 24px 16px; } }
</style>
</head>
<body>
  <div class="header">
    <h1>Fitness by Maddy</h1>
    <h2>Week ${weekNo} Program</h2>
    <p>${client.name} · ${client.program?.toUpperCase() || 'CUSTOM'}</p>
  </div>

  <h2 class="section-title">Workout Plan</h2>
  ${workoutRows}
  ${workout.weekly_notes ? `<p style="color:#888; font-size:14px; margin-top:16px;">${workout.weekly_notes}</p>` : ''}

  <h2 class="section-title">Nutrition Plan</h2>
  <div class="nutrition-summary">
    <div class="macro-box"><div class="value">${nutrition.daily_calories || '-'}</div><div class="label">Calories</div></div>
    <div class="macro-box"><div class="value">${nutrition.protein_g || '-'}g</div><div class="label">Protein</div></div>
    <div class="macro-box"><div class="value">${nutrition.carbs_g || '-'}g</div><div class="label">Carbs</div></div>
    <div class="macro-box"><div class="value">${nutrition.fat_g || '-'}g</div><div class="label">Fat</div></div>
  </div>
  ${mealRows}
  ${nutrition.hydration ? `<p style="color:#888; margin-top:12px;">💧 ${nutrition.hydration}</p>` : ''}

  ${program.coach_notes ? `
  <div class="coach-notes">
    <h3>Coach Notes</h3>
    <p>${program.coach_notes}</p>
  </div>` : ''}

  <div class="footer">
    <p>Fitness by Maddy · fitnessbymaddy.com</p>
  </div>
</body>
</html>`;
}
