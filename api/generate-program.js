const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalate } = require('../lib/escalation');
const { cors } = require('../lib/helpers');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'starvation',
  'clenbuterol', 'dnp', 'ephedrine', 'sarm', 'steroid',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) return res.status(400).json({ error: 'Missing client_id or week_no' });

  const client = await supabase.from('clients').select('*').eq('id', client_id).single();
  if (!client.data) return res.status(404).json({ error: 'Client not found' });

  const { data: recentCheckins } = await supabase
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const lead = client.data.lead_id
    ? (await supabase.from('leads').select('*').eq('id', client.data.lead_id).single()).data
    : null;

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const systemPrompt = `You are a certified personal trainer and nutrition coach creating a weekly program for a fitness client.
Output ONLY valid JSON with two keys: "workout_plan" and "nutrition_plan".
workout_plan: object with keys for each training day (e.g., "day1_push", "day2_pull") each containing an array of exercise objects {name, sets, reps, rest, notes}.
nutrition_plan: object with keys {daily_calories, protein_g, carbs_g, fats_g, meal_1, meal_2, meal_3, snack, hydration, supplements}.
Be specific, evidence-based, and progressive. Never recommend extreme calorie restriction (<1200 for women, <1500 for men), banned substances, or unrealistic timelines.`;

  const userPrompt = `Client: ${client.data.name || 'Anonymous'}
Program: ${client.data.program}
Week: ${week_no}
${lead?.intake_data ? `Intake data: ${JSON.stringify(lead.intake_data)}` : ''}
${recentCheckins?.length ? `Recent check-ins: ${JSON.stringify(recentCheckins)}` : 'No previous check-ins.'}
Generate Week ${week_no} program.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return res.status(500).json({ error: 'Failed to parse program JSON' });

  let programData;
  try {
    programData = JSON.parse(jsonMatch[0]);
  } catch {
    return res.status(500).json({ error: 'Invalid JSON from AI' });
  }

  const textLower = text.toLowerCase();
  const flagged = SAFETY_FLAGS.some(flag => textLower.includes(flag));
  if (flagged) {
    await escalate(client.data.phone, 'unsafe_program_content', `Week ${week_no} flagged for safety review`, client_id);
    return res.json({ success: false, reason: 'flagged_for_review' });
  }

  const pdfContent = generatePdfHtml(client.data, week_no, programData);
  const pdfBuffer = Buffer.from(pdfContent, 'utf-8');
  const pdfPath = `clients/${client_id}/week_${week_no}.html`;

  await supabase.storage.from('clients').upload(pdfPath, pdfBuffer, {
    contentType: 'text/html',
    upsert: true,
  });

  const { data: urlData } = supabase.storage.from('clients').getPublicUrl(pdfPath);
  const pdfUrl = urlData?.publicUrl || pdfPath;

  const { data: program, error } = await supabase.from('programs').insert({
    client_id,
    week_no: parseInt(week_no),
    pdf_url: pdfUrl,
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: `Generated for week ${week_no}`,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  const msg = `Week ${week_no} program is ready! Check your plan here: ${pdfUrl}`;
  await sendWhatsApp(client.data.phone, msg, null);
  await supabase.from('programs').update({ whatsapp_sent_at: new Date().toISOString() }).eq('id', program.id);

  return res.json({ success: true, program_id: program.id });
};

function generatePdfHtml(client, weekNo, data) {
  const workoutRows = Object.entries(data.workout_plan || {}).map(([day, exercises]) => {
    const exRows = (Array.isArray(exercises) ? exercises : []).map(ex =>
      `<tr><td>${ex.name || ''}</td><td>${ex.sets || ''}</td><td>${ex.reps || ''}</td><td>${ex.rest || ''}</td><td>${ex.notes || ''}</td></tr>`
    ).join('');
    return `<h3 style="color:#B8965A;margin:24px 0 8px;font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:2px;">${day.replace(/_/g, ' ').toUpperCase()}</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <tr style="background:#2C2C2C;color:#B8965A;"><th style="padding:8px;text-align:left;">Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th><th>Notes</th></tr>
      ${exRows}
    </table>`;
  }).join('');

  const np = data.nutrition_plan || {};
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Week ${weekNo} Program - ${client.name || 'Client'}</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  body{font-family:'DM Sans',sans-serif;background:#1a1a1a;color:#FAF8F4;padding:40px;max-width:800px;margin:0 auto;}
  h1{font-family:'Bebas Neue',sans-serif;color:#B8965A;font-size:36px;letter-spacing:4px;border-bottom:2px solid #B8965A;padding-bottom:12px;}
  h2{font-family:'Bebas Neue',sans-serif;color:#FAF8F4;font-size:24px;letter-spacing:2px;margin-top:32px;}
  table{font-size:14px;} th,td{padding:8px 12px;border-bottom:1px solid #333;text-align:left;}
  .macro-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0;}
  .macro-card{background:#2C2C2C;padding:16px;border-radius:4px;text-align:center;}
  .macro-val{font-family:'Bebas Neue',sans-serif;font-size:28px;color:#B8965A;}
  .macro-label{font-size:11px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-top:4px;}
  .meal{background:#2C2C2C;padding:16px;border-radius:4px;margin:8px 0;}
  .meal-title{color:#B8965A;font-weight:500;margin-bottom:4px;}
  .footer{text-align:center;margin-top:40px;padding-top:20px;border-top:1px solid #333;color:#555;font-size:12px;}
</style></head><body>
<h1>FITNESS BY MADDY</h1>
<p style="color:#888;">Week ${weekNo} Program for <strong style="color:#FAF8F4;">${client.name || 'Client'}</strong></p>
<h2>WORKOUT PLAN</h2>
${workoutRows}
<h2>NUTRITION PLAN</h2>
<div class="macro-grid">
  <div class="macro-card"><div class="macro-val">${np.daily_calories || '—'}</div><div class="macro-label">Calories</div></div>
  <div class="macro-card"><div class="macro-val">${np.protein_g || '—'}g</div><div class="macro-label">Protein</div></div>
  <div class="macro-card"><div class="macro-val">${np.carbs_g || '—'}g</div><div class="macro-label">Carbs</div></div>
  <div class="macro-card"><div class="macro-val">${np.fats_g || '—'}g</div><div class="macro-label">Fats</div></div>
</div>
${np.meal_1 ? `<div class="meal"><div class="meal-title">Meal 1</div>${np.meal_1}</div>` : ''}
${np.meal_2 ? `<div class="meal"><div class="meal-title">Meal 2</div>${np.meal_2}</div>` : ''}
${np.meal_3 ? `<div class="meal"><div class="meal-title">Meal 3</div>${np.meal_3}</div>` : ''}
${np.snack ? `<div class="meal"><div class="meal-title">Snack</div>${np.snack}</div>` : ''}
${np.hydration ? `<p style="margin-top:16px;color:#888;">Hydration: ${np.hydration}</p>` : ''}
${np.supplements ? `<p style="color:#888;">Supplements: ${np.supplements}</p>` : ''}
<div class="footer">Fitness by Maddy | fitnessbymaddy.com | This program is personalised — do not share.</div>
</body></html>`;
}
