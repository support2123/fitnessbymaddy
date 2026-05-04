const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

const UNSAFE_PATTERNS = [
  /below\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarms/i,
  /lose\s*\d{2,}\s*(kg|lbs?)\s*in\s*(1|2|3)\s*week/i,
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intake } = await db
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .single();

    const anthropic = new Anthropic();

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy.
Create a detailed weekly program based on client data. Output valid JSON only with this structure:
{
  "workout_plan": { "days": [...], "notes": "..." },
  "nutrition_plan": { "calories": ..., "protein": ..., "meals": [...], "notes": "..." },
  "weekly_focus": "...",
  "coach_note": "..."
}
Rules:
- Never prescribe below 1400 calories for women or 1600 for men
- Never recommend banned substances
- Never promise specific weight loss timelines
- Adjust based on compliance score and reported issues
- Be encouraging but realistic`;

    const userPrompt = `Client: ${client.name}
Program: ${client.program} — Week ${week_no} of 12
${intake ? `Profile: Age ${intake.age}, ${intake.gender}, Goal: ${intake.goal}, Diet: ${intake.diet_preference}, Injuries: ${intake.injuries || 'none'}, Schedule: ${intake.schedule}` : ''}
Recent check-ins: ${JSON.stringify(checkins || [])}
Generate Week ${week_no} program.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;

    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(content)) {
        await db.from('programs').insert({
          client_id,
          week_no,
          generated_at: new Date().toISOString(),
          workout_plan: null,
          nutrition_plan: null,
          notes: 'FLAGGED: Unsafe content detected — awaiting Maddy review',
        });
        return res.status(200).json({ flagged: true, reason: 'Unsafe content detected' });
      }
    }

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    const pdfContent = generatePDFHTML(client, week_no, parsed);
    const pdfBuffer = Buffer.from(pdfContent, 'utf-8');
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await db.storage.from('programs').upload(pdfPath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true,
    });

    const { data: urlData } = db.storage.from('programs').getPublicUrl(pdfPath);

    const { error: insertErr } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: urlData.publicUrl,
      whatsapp_sent_at: new Date().toISOString(),
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.coach_note || '',
    });

    if (insertErr) {
      console.error('Program insert error:', insertErr.message);
    }

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name,
      `Week ${week_no}`,
      parsed.weekly_focus || 'Keep pushing!',
    ], urlData.publicUrl);

    return res.status(200).json({ success: true, week_no, pdf_url: urlData.publicUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};

function generatePDFHTML(client, weekNo, plan) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Week ${weekNo} Program — ${client.name}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #fff; padding: 40px; }
  h1, h2, h3 { font-family: 'Bebas Neue', sans-serif; color: #D4AF7A; letter-spacing: 2px; }
  h1 { font-size: 42px; margin-bottom: 8px; }
  .subtitle { color: #999; font-size: 14px; margin-bottom: 32px; }
  .section { background: #2a2a2a; border-radius: 12px; padding: 24px; margin-bottom: 20px; border-left: 4px solid #B8965A; }
  .section h2 { font-size: 24px; margin-bottom: 12px; }
  .day { margin-bottom: 16px; }
  .day h3 { font-size: 18px; color: #fff; margin-bottom: 6px; }
  .day p { color: #ccc; font-size: 14px; line-height: 1.6; }
  .nutrition { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .macro-box { background: #333; border-radius: 8px; padding: 16px; text-align: center; }
  .macro-box .num { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #D4AF7A; }
  .macro-box .label { font-size: 12px; color: #999; text-transform: uppercase; }
  .coach-note { background: linear-gradient(135deg, #2a2a1a, #1a2a1a); border: 1px solid #B8965A; border-radius: 12px; padding: 20px; margin-top: 24px; }
  .coach-note p { color: #ddd; font-style: italic; line-height: 1.6; }
  .brand { text-align: center; margin-top: 40px; color: #666; font-size: 12px; }
</style>
</head>
<body>
  <h1>WEEK ${weekNo} PROGRAM</h1>
  <p class="subtitle">${client.name} | ${client.program.replace('_', ' ').toUpperCase()} | FitnessByMaddy</p>

  <div class="section">
    <h2>WORKOUT PLAN</h2>
    ${(plan.workout_plan.days || []).map(day => `
      <div class="day">
        <h3>${day.day || day.name || ''}</h3>
        <p>${Array.isArray(day.exercises) ? day.exercises.join(' • ') : (day.description || day.exercises || '')}</p>
      </div>
    `).join('')}
    ${plan.workout_plan.notes ? `<p style="color:#999;margin-top:12px;">${plan.workout_plan.notes}</p>` : ''}
  </div>

  <div class="section">
    <h2>NUTRITION PLAN</h2>
    <div class="nutrition">
      <div class="macro-box"><div class="num">${plan.nutrition_plan.calories || '—'}</div><div class="label">Calories</div></div>
      <div class="macro-box"><div class="num">${plan.nutrition_plan.protein || '—'}g</div><div class="label">Protein</div></div>
    </div>
    ${(plan.nutrition_plan.meals || []).map(meal => `<p style="color:#ccc;margin-top:8px;">• ${typeof meal === 'string' ? meal : meal.name || JSON.stringify(meal)}</p>`).join('')}
    ${plan.nutrition_plan.notes ? `<p style="color:#999;margin-top:12px;">${plan.nutrition_plan.notes}</p>` : ''}
  </div>

  ${plan.coach_note ? `
  <div class="coach-note">
    <h2>COACH'S NOTE</h2>
    <p>${plan.coach_note}</p>
  </div>` : ''}

  <p class="brand">FitnessByMaddy • Personalised Coaching • fitnessbymaddy.com</p>
</body>
</html>`;
}
