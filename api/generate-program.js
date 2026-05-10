const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 800', 'below 1000', 'starvation',
  'clenbuterol', 'dnp', 'dinitrophenol', 'ephedra', 'sarm',
  'steroid', 'anabolic', 'lose 10kg in 1 week', 'lose 20 pounds in'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy, an elite online coaching brand. You create safe, effective, science-backed weekly programs.

RULES:
- Never prescribe extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances, SARMs, steroids, or dangerous supplements
- Never promise unrealistic timelines (max 0.5-1kg fat loss per week)
- Always include warm-up and cool-down
- Progressive overload: increase volume/intensity by 5-10% weekly
- Include rest days and deload guidance
- Adapt based on compliance score and energy levels from check-ins
- Output ONLY valid JSON with keys: workout_plan, nutrition_plan, notes`;

    const userPrompt = `Generate Week ${week_no} program for this client:

Client: ${client.name || 'Client'}
Program: ${client.program}
Started: ${client.program_started_at}

${recentCheckins && recentCheckins.length > 0 ? `Recent check-ins:
${recentCheckins.map(c => `  Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n')}` : 'No check-in data yet (Week 1).'}

${prevProgram ? `Previous program notes: ${prevProgram.notes || 'None'}` : ''}

Return JSON: { "workout_plan": { "days": [...] }, "nutrition_plan": { "calories": ..., "macros": {...}, "meals": [...] }, "notes": "..." }`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;

    if (hasSafetyIssue(responseText)) {
      const { escalateToMaddy } = require('./lib/escalation');
      await escalateToMaddy('Safety flag in generated program', {
        clientName: client.name,
        weekNo: week_no,
        flaggedContent: responseText.substring(0, 500)
      });
      return res.json({ ok: false, reason: 'safety_review_needed' });
    }

    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch {
      programData = {
        workout_plan: { raw: responseText },
        nutrition_plan: {},
        notes: 'Auto-parsed from text response'
      };
    }

    const pdfHtml = generatePdfHtml(client, week_no, programData);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await supabase.storage.from('clients').upload(pdfPath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true
    });

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { error } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        generated_at: new Date().toISOString(),
        pdf_url: pdfUrl,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.notes
      });

    if (error) throw error;

    await sendWhatsApp(client.phone, {
      text: `📋 Week ${week_no} program is ready!\n\n${programData.notes || 'New week, new gains!'}\n\n📥 View: ${pdfUrl}`,
      isClient: true
    });

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.json({ ok: true, programUrl: pdfUrl });
  } catch (err) {
    console.error('Program gen error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generatePdfHtml(client, weekNo, program) {
  const workoutDays = program.workout_plan?.days || [];
  const nutrition = program.nutrition_plan || {};

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #fff; padding: 40px 24px; }
.header { text-align: center; border-bottom: 2px solid #B8965A; padding-bottom: 24px; margin-bottom: 32px; }
.brand { font-family: 'Bebas Neue', sans-serif; font-size: 28px; letter-spacing: 4px; color: #B8965A; }
.week-title { font-family: 'Bebas Neue', sans-serif; font-size: 48px; letter-spacing: 2px; margin-top: 8px; }
.client-name { font-size: 14px; color: #999; margin-top: 4px; }
.section { margin-bottom: 32px; }
.section-title { font-family: 'Bebas Neue', sans-serif; font-size: 24px; letter-spacing: 2px; color: #B8965A; margin-bottom: 16px; border-bottom: 1px solid #333; padding-bottom: 8px; }
.day { background: #222; border-radius: 8px; padding: 20px; margin-bottom: 12px; border-left: 3px solid #B8965A; }
.day-name { font-family: 'Bebas Neue', sans-serif; font-size: 18px; letter-spacing: 1px; margin-bottom: 8px; }
.exercise { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #2a2a2a; font-size: 14px; }
.exercise:last-child { border-bottom: none; }
.exercise-name { color: #ddd; }
.exercise-detail { color: #B8965A; font-weight: 500; }
.macro-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.macro-box { background: #222; padding: 16px; border-radius: 8px; text-align: center; }
.macro-value { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #B8965A; }
.macro-label { font-size: 11px; color: #999; letter-spacing: 1px; text-transform: uppercase; margin-top: 4px; }
.notes { background: #222; padding: 20px; border-radius: 8px; font-size: 14px; line-height: 1.7; color: #ccc; }
.footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #333; font-size: 12px; color: #666; }
</style>
</head>
<body>
<div class="header">
  <div class="brand">FITNESS BY MADDY</div>
  <div class="week-title">WEEK ${weekNo}</div>
  <div class="client-name">${client.name || 'Client'} — ${client.program}</div>
</div>

<div class="section">
  <div class="section-title">WORKOUT PLAN</div>
  ${workoutDays.map(day => `
  <div class="day">
    <div class="day-name">${day.name || day.day || 'Training Day'}</div>
    ${(day.exercises || []).map(ex => `
    <div class="exercise">
      <span class="exercise-name">${ex.name || ex}</span>
      <span class="exercise-detail">${ex.sets ? ex.sets + ' x ' + ex.reps : ''} ${ex.rest ? '| Rest: ' + ex.rest : ''}</span>
    </div>`).join('')}
  </div>`).join('')}
</div>

<div class="section">
  <div class="section-title">NUTRITION PLAN</div>
  <div class="macro-grid">
    <div class="macro-box"><div class="macro-value">${nutrition.calories || '—'}</div><div class="macro-label">Calories</div></div>
    <div class="macro-box"><div class="macro-value">${nutrition.macros?.protein || '—'}g</div><div class="macro-label">Protein</div></div>
    <div class="macro-box"><div class="macro-value">${nutrition.macros?.carbs || '—'}g</div><div class="macro-label">Carbs</div></div>
    <div class="macro-box"><div class="macro-value">${nutrition.macros?.fat || '—'}g</div><div class="macro-label">Fat</div></div>
  </div>
</div>

${program.notes ? `<div class="section"><div class="section-title">COACH NOTES</div><div class="notes">${program.notes}</div></div>` : ''}

<div class="footer">FITNESS BY MADDY — fitnessbymaddy.com</div>
</body>
</html>`;
}
