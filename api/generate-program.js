const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendMediaMessage } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

const UNSAFE_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedra/i,
  /anabolic\s*steroid/i,
  /sarm/i,
  /lose\s*\d{2,}\s*kg\s*in\s*\d\s*week/i
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
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

    const systemPrompt = `You are a certified personal trainer and nutrition coach creating weekly training and nutrition programs for FitnessByMaddy clients. You create safe, evidence-based programs.

RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances, SARMs, steroids, or dangerous supplements
- Never promise unrealistic results (e.g., "lose 10kg in 1 week")
- Always include rest days (minimum 1-2 per week)
- Always include warm-up and cool-down guidance
- Adjust intensity based on compliance score and energy levels from check-ins
- If client reports pain or injury, reduce intensity and flag for review

OUTPUT FORMAT: Return valid JSON with two keys:
{
  "workout_plan": {
    "days": [
      {"day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..."}]},
      ...
    ],
    "notes": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [
      {"meal": "Breakfast", "options": ["..."]},
      ...
    ],
    "supplements": ["..."],
    "hydration": "...",
    "notes": "..."
  }
}`;

    const clientContext = `
Client Profile:
- Name: ${client.name || 'N/A'}
- Program: ${client.program}
- Goal: ${client.goal || 'General fitness'}
- Age: ${client.age || 'N/A'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}

Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}

Recent Check-ins:
${recentCheckins?.length ? recentCheckins.map(c =>
  `Week ${c.week_no}: Weight=${c.weight || 'N/A'}kg, Waist=${c.waist || 'N/A'}cm, Compliance=${c.compliance_score || 'N/A'}/10, Energy=${c.energy || 'N/A'}/10, Issues: ${c.issues || 'None'}`
).join('\n') : 'No check-ins yet (first week)'}

${lastProgram ? `Last week's focus: ${lastProgram.notes || 'Standard progression'}` : 'First program — establish baseline.'}

Generate the Week ${week_no} program. Return only valid JSON.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: clientContext }]
    });

    const rawOutput = response.content[0].text;

    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(rawOutput)) {
        await escalateToMaddy(
          'Unsafe content detected in generated program',
          client.phone,
          `Week ${week_no} program contained: ${pattern.source}`
        );
        return res.status(422).json({ error: 'Flagged for review — unsafe content detected' });
      }
    }

    let parsed;
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(422).json({ error: 'Failed to parse program JSON' });
    }

    const pdfContent = generatePdfHtml(client, week_no, parsed);
    const pdfBuffer = Buffer.from(pdfContent);
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await db.storage.from('programs').upload(pdfPath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true
    });

    const { data: urlData } = db.storage.from('programs').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { error: insertErr } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: `Week ${week_no} auto-generated`
    });

    if (insertErr) throw insertErr;

    const contextNote = `Here's your Week ${week_no} program! ${parsed.workout_plan?.notes || 'Stay consistent and reach out if you have questions.'}`;
    await sendMediaMessage(client.phone, contextNote, pdfUrl);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.json({ success: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generatePdfHtml(client, weekNo, plan) {
  const workoutRows = (plan.workout_plan?.days || []).map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr><td>${ex.name}</td><td>${ex.sets}x${ex.reps}</td><td>${ex.rest || '60s'}</td><td>${ex.notes || ''}</td></tr>`
    ).join('');
    return `
      <div class="day-block">
        <h3>${day.day} — ${day.focus}</h3>
        <table>
          <thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Notes</th></tr></thead>
          <tbody>${exercises}</tbody>
        </table>
      </div>`;
  }).join('');

  const mealRows = (plan.nutrition_plan?.meals || []).map(m =>
    `<div class="meal"><strong>${m.meal}:</strong> ${(m.options || []).join(' / ')}</div>`
  ).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #fff; padding: 40px; }
  .header { text-align: center; padding: 40px 0; border-bottom: 2px solid #B8965A; margin-bottom: 40px; }
  .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; letter-spacing: 4px; color: #B8965A; }
  .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #fff; margin-top: 8px; }
  .header p { color: #888; font-size: 14px; margin-top: 8px; }
  .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 24px; color: #B8965A; margin: 32px 0 16px; letter-spacing: 2px; }
  .day-block { background: #222; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
  .day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 20px; color: #D4AF7A; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 8px; border-bottom: 1px solid #444; color: #B8965A; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
  td { padding: 8px; border-bottom: 1px solid #333; font-size: 14px; color: #ccc; }
  .nutrition { background: #222; border-radius: 8px; padding: 24px; }
  .macros { display: flex; gap: 24px; margin: 16px 0; flex-wrap: wrap; }
  .macro { background: #333; padding: 16px 24px; border-radius: 8px; text-align: center; }
  .macro .num { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; }
  .macro .label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
  .meal { padding: 8px 0; border-bottom: 1px solid #333; font-size: 14px; color: #ccc; }
  .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #333; color: #555; font-size: 12px; }
</style>
</head>
<body>
  <div class="header">
    <h1>Fitness by Maddy</h1>
    <h2>Week ${weekNo} Program</h2>
    <p>${client.name || 'Client'} | ${client.program?.toUpperCase() || 'CUSTOM'}</p>
  </div>

  <div class="section-title">Workout Plan</div>
  ${workoutRows}
  ${plan.workout_plan?.notes ? `<p style="color:#888; margin-top:16px; font-style:italic;">${plan.workout_plan.notes}</p>` : ''}

  <div class="section-title">Nutrition Plan</div>
  <div class="nutrition">
    <div class="macros">
      <div class="macro"><div class="num">${plan.nutrition_plan?.calories || '—'}</div><div class="label">Calories</div></div>
      <div class="macro"><div class="num">${plan.nutrition_plan?.protein_g || '—'}g</div><div class="label">Protein</div></div>
      <div class="macro"><div class="num">${plan.nutrition_plan?.carbs_g || '—'}g</div><div class="label">Carbs</div></div>
      <div class="macro"><div class="num">${plan.nutrition_plan?.fat_g || '—'}g</div><div class="label">Fat</div></div>
    </div>
    ${mealRows}
    ${plan.nutrition_plan?.hydration ? `<p style="margin-top:16px; color:#888;">Hydration: ${plan.nutrition_plan.hydration}</p>` : ''}
    ${plan.nutrition_plan?.supplements?.length ? `<p style="margin-top:8px; color:#888;">Supplements: ${plan.nutrition_plan.supplements.join(', ')}</p>` : ''}
  </div>

  <div class="footer">
    <p>Fitness by Maddy | fitnessbymaddy.com</p>
    <p>This program was designed specifically for you. Do not share or redistribute.</p>
  </div>
</body>
</html>`;
}
