const { getSupabase } = require('./lib/supabase');
const { sendTemplate, notifyMaddy } = require('./lib/whatsapp');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'starvation',
  'clenbuterol', 'dnp', 'ephedrine', 'sarms', 'steroids',
  'lose 10kg in 1 week', 'extreme deficit'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const claudeKey = process.env.CLAUDE_API_KEY;

  try {
    const { client_id, week_no, trigger } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await db.from('clients')
      .select('*').eq('id', client_id).single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await db.from('lead_intake')
      .select('*').eq('lead_id', client.lead_id).single();

    const { data: checkins } = await db.from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const prompt = buildPrompt(client, intake, checkins, week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const claudeData = await claudeRes.json();
    const rawOutput = claudeData.content?.[0]?.text || '';

    const isSafe = !SAFETY_FLAGS.some(flag => rawOutput.toLowerCase().includes(flag));
    if (!isSafe) {
      await notifyMaddy(
        'Program safety flag',
        `Client ${client.name} (Week ${week_no}): Generated program contains flagged content. Review required before sending.`
      );
      await db.from('programs').insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        workout_plan: {},
        nutrition_plan: {},
        notes: 'FLAGGED FOR REVIEW — safety check failed'
      });
      return res.status(200).json({ success: false, reason: 'safety_flagged' });
    }

    let parsed;
    try {
      const jsonMatch = rawOutput.match(/```json\n?([\s\S]*?)\n?```/) || rawOutput.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : rawOutput);
    } catch {
      parsed = { raw: rawOutput, workout_plan: {}, nutrition_plan: {} };
    }

    const workoutPlan = parsed.workout_plan || parsed.workouts || {};
    const nutritionPlan = parsed.nutrition_plan || parsed.nutrition || {};
    const notes = parsed.notes || parsed.coach_notes || '';

    const pdfHtml = renderProgramPdf(client, week_no, workoutPlan, nutritionPlan, notes);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await db.storage.from('programs').upload(pdfPath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true
    });

    const { data: publicUrl } = db.storage.from('programs').getPublicUrl(pdfPath);

    const { data: program, error } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: publicUrl?.publicUrl || pdfPath,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes
    }).select().single();

    if (error) {
      console.error('Program save error:', error.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      publicUrl?.publicUrl || ''
    ]);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const lastCheckin = checkins?.[0];
  const prevCheckin = checkins?.[1];

  return `You are "Program Architect" for Fitness by Maddy, an elite online coaching brand. Generate a week ${weekNo} customized program.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Age: ${intake?.age || 'unknown'}
- Gender: ${intake?.gender || 'unknown'}
- Goal: ${intake?.goal || 'general fitness'}
- Injuries/Limitations: ${intake?.injuries || 'none reported'}
- Diet Preference: ${intake?.diet_pref || 'flexible'}
- Experience Level: ${intake?.experience_level || 'intermediate'}
- Medical Conditions: ${intake?.medical_conditions || 'none reported'}
- Schedule: ${intake?.schedule || 'flexible'}

${lastCheckin ? `LAST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'none'}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10` : ''}

OUTPUT FORMAT — respond with ONLY valid JSON:
{
  "workout_plan": {
    "day_1": { "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..."}] },
    "day_2": { ... },
    ...up to 5-6 days
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 150,
    "carbs_g": 250,
    "fats_g": 70,
    "meal_1": { "time": "7:00 AM", "description": "..." },
    ...
  },
  "notes": "One paragraph coach note to the client (warm, expert tone)"
}

RULES:
- Science-backed, safe progressions only
- Never recommend below 1200 calories for women or 1500 for men
- No banned substances or extreme protocols
- If injuries are reported, provide modifications
- Adjust volume/intensity based on compliance and energy scores
- Keep nutrition culturally appropriate (Indian diet options for IN market)`;
}

function renderProgramPdf(client, weekNo, workout, nutrition, notes) {
  const days = Object.entries(workout).map(([day, data]) => {
    const dayLabel = day.replace('_', ' ').toUpperCase();
    const exercises = (data.exercises || []).map(ex =>
      `<tr>
        <td>${ex.name}</td>
        <td>${ex.sets} x ${ex.reps}</td>
        <td>${ex.rest || '60s'}</td>
        <td>${ex.notes || ''}</td>
      </tr>`
    ).join('');

    return `<div class="day-block">
      <h3>${dayLabel} — ${data.focus || ''}</h3>
      <table>
        <thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Notes</th></tr></thead>
        <tbody>${exercises}</tbody>
      </table>
    </div>`;
  }).join('');

  const meals = Object.entries(nutrition)
    .filter(([k]) => k.startsWith('meal'))
    .map(([, meal]) => `<div class="meal"><strong>${meal.time}</strong>: ${meal.description}</div>`)
    .join('');

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #fff; padding: 40px 24px; }
  .header { text-align: center; margin-bottom: 48px; padding-bottom: 32px; border-bottom: 2px solid #B8965A; }
  .brand { font-family: 'Bebas Neue', sans-serif; font-size: 14px; letter-spacing: 6px; color: #B8965A; text-transform: uppercase; margin-bottom: 8px; }
  h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #fff; letter-spacing: 3px; }
  h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #B8965A; letter-spacing: 2px; margin: 32px 0 16px; }
  h3 { font-family: 'Bebas Neue', sans-serif; font-size: 20px; color: #D4AF7A; margin-bottom: 12px; letter-spacing: 1px; }
  .meta { font-size: 14px; color: #999; margin-top: 8px; }
  .day-block { background: #222; border-radius: 8px; padding: 24px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #B8965A; padding: 8px 12px; border-bottom: 1px solid #333; }
  td { font-size: 14px; padding: 10px 12px; border-bottom: 1px solid #2a2a2a; color: #ddd; }
  .nutrition-box { background: #222; border-radius: 8px; padding: 24px; margin-bottom: 16px; }
  .macros { display: flex; gap: 24px; margin-bottom: 20px; flex-wrap: wrap; }
  .macro { text-align: center; }
  .macro-val { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #B8965A; }
  .macro-label { font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: 1px; }
  .meal { padding: 12px 0; border-bottom: 1px solid #2a2a2a; font-size: 14px; color: #ddd; }
  .notes { background: linear-gradient(135deg, #2a2a1a, #1a1a1a); border-left: 3px solid #B8965A; padding: 20px 24px; margin-top: 32px; border-radius: 0 8px 8px 0; }
  .notes p { font-size: 15px; line-height: 1.7; color: #ccc; font-style: italic; }
  .footer { text-align: center; margin-top: 48px; padding-top: 24px; border-top: 1px solid #333; }
  .footer p { font-size: 12px; color: #666; }
</style>
</head><body>
  <div class="header">
    <div class="brand">Fitness by Maddy</div>
    <h1>Week ${weekNo} Program</h1>
    <div class="meta">${client.name} &middot; ${client.program?.replace(/_/g, ' ').toUpperCase()}</div>
  </div>
  <h2>Workout Plan</h2>
  ${days}
  <h2>Nutrition Plan</h2>
  <div class="nutrition-box">
    <div class="macros">
      <div class="macro"><div class="macro-val">${nutrition.calories || '—'}</div><div class="macro-label">Calories</div></div>
      <div class="macro"><div class="macro-val">${nutrition.protein_g || '—'}g</div><div class="macro-label">Protein</div></div>
      <div class="macro"><div class="macro-val">${nutrition.carbs_g || '—'}g</div><div class="macro-label">Carbs</div></div>
      <div class="macro"><div class="macro-val">${nutrition.fats_g || '—'}g</div><div class="macro-label">Fats</div></div>
    </div>
    ${meals}
  </div>
  ${notes ? `<div class="notes"><h3>Coach's Note</h3><p>${notes}</p></div>` : ''}
  <div class="footer"><p>&copy; Fitness by Maddy &middot; fitnessbymaddy.com</p></div>
</body></html>`;
}
