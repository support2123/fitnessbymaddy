const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone, jsonResponse, errorResponse } = require('./_lib/utils');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'sarm', 'steroid',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return errorResponse(res, 'POST only', 405);

  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return errorResponse(res, 'Unauthorized', 401);
  }

  const { client_id, week_no } = req.body || {};
  if (!client_id || !week_no) {
    return errorResponse(res, 'client_id and week_no required');
  }

  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .maybeSingle();

  if (!client) return errorResponse(res, 'Client not found', 404);

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
    .maybeSingle();

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const systemPrompt = `You are Maddy's program architect. You design weekly workout and nutrition plans for fitness coaching clients.

Rules:
- Be evidence-based and realistic
- Never prescribe extreme calorie deficits (min 1200 cal for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Adjust based on compliance and energy scores from check-ins
- Account for any reported injuries or issues
- Format output as JSON with "workout_plan" and "nutrition_plan" keys
- Include a "notes" field with a brief coach's note for the client`;

  const userPrompt = `Generate Week ${week_no} program for this client:

Client: ${client.name || 'Client'}
Program: ${client.program}
Started: ${client.program_started_at}

Recent check-ins (newest first):
${recentCheckins?.length ? recentCheckins.map(c => `  Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`).join('\n') : '  No check-ins yet (Week 1)'}

${lastProgram ? `Last week's plan summary: ${JSON.stringify(lastProgram.workout_plan || {}).slice(0, 500)}` : 'First week - create a baseline program.'}

Return a JSON object with keys: workout_plan, nutrition_plan, notes`;

  let response;
  try {
    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (err) {
    console.error('Claude API error:', err.message);
    return errorResponse(res, 'AI generation failed', 500);
  }

  const rawText = response.content[0]?.text || '';

  const lowerText = rawText.toLowerCase();
  const hasSafetyIssue = SAFETY_FLAGS.some(flag => lowerText.includes(flag));

  if (hasSafetyIssue) {
    await notifyMaddy(
      'Program safety flag',
      `Client: ${maskPhone(client.phone)}\nWeek: ${week_no}\nThe AI-generated program triggered a safety flag. Please review before sending.`
    );
    return jsonResponse(res, { ok: false, reason: 'safety_flagged', week_no });
  }

  let parsed;
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch {
    parsed = null;
  }

  if (!parsed || !parsed.workout_plan) {
    return errorResponse(res, 'Failed to parse program output', 500);
  }

  const pdfHtml = renderProgramPdf(client, week_no, parsed);
  const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');
  const pdfPath = `clients/${client.id}/week_${week_no}.html`;

  await db.storage.from('clients').upload(pdfPath, pdfBuffer, {
    contentType: 'text/html',
    upsert: true,
  });

  const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
  const pdfUrl = urlData?.publicUrl || pdfPath;

  const { data: program } = await db.from('programs').insert({
    client_id,
    week_no: parseInt(week_no),
    pdf_url: pdfUrl,
    workout_plan: parsed.workout_plan,
    nutrition_plan: parsed.nutrition_plan,
    notes: parsed.notes || null,
  }).select().single();

  const contextNote = parsed.notes || `Week ${week_no} program ready!`;
  await sendWhatsApp(client.phone, 'weekly_program', [
    client.name || 'there',
    `Week ${week_no}`,
    contextNote.slice(0, 200),
  ], pdfUrl);

  await db.from('programs').update({
    whatsapp_sent_at: new Date().toISOString(),
  }).eq('id', program.id);

  return jsonResponse(res, { ok: true, program_id: program.id, week_no });
};

function renderProgramPdf(client, weekNo, plan) {
  const workoutRows = Object.entries(plan.workout_plan || {}).map(([day, exercises]) => {
    const exerciseList = Array.isArray(exercises)
      ? exercises.map(e => `<li>${typeof e === 'string' ? e : `${e.name || e.exercise} - ${e.sets || ''}x${e.reps || ''} ${e.notes || ''}`}</li>`).join('')
      : `<li>${JSON.stringify(exercises)}</li>`;
    return `<tr><td class="day">${day}</td><td><ul>${exerciseList}</ul></td></tr>`;
  }).join('');

  const nutritionContent = typeof plan.nutrition_plan === 'string'
    ? `<p>${plan.nutrition_plan}</p>`
    : `<pre>${JSON.stringify(plan.nutrition_plan, null, 2)}</pre>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #fff; padding: 40px; }
  .header { text-align: center; border-bottom: 2px solid #B8965A; padding-bottom: 24px; margin-bottom: 32px; }
  .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 42px; color: #B8965A; letter-spacing: 4px; }
  .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 24px; color: #fff; letter-spacing: 2px; margin-top: 8px; }
  .header p { color: #888; font-size: 14px; margin-top: 8px; }
  .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #B8965A; letter-spacing: 2px; margin: 32px 0 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  td { padding: 12px 16px; border-bottom: 1px solid #333; vertical-align: top; }
  .day { font-weight: 600; color: #B8965A; width: 120px; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
  ul { list-style: none; }
  ul li { padding: 4px 0; font-size: 14px; color: #ccc; }
  ul li::before { content: '→ '; color: #B8965A; }
  .notes { background: #222; padding: 20px; border-left: 3px solid #B8965A; margin-top: 24px; border-radius: 4px; }
  .notes p { font-size: 14px; color: #ccc; line-height: 1.6; }
  pre { font-size: 13px; color: #ccc; white-space: pre-wrap; line-height: 1.6; }
  .footer { text-align: center; margin-top: 48px; padding-top: 24px; border-top: 1px solid #333; }
  .footer p { font-size: 12px; color: #555; }
</style>
</head>
<body>
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <h2>WEEK ${weekNo} PROGRAM</h2>
    <p>${client.name || 'Client'} &middot; ${client.program} &middot; ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
  </div>

  <div class="section-title">WORKOUT PLAN</div>
  <table>${workoutRows || '<tr><td>See attached details</td></tr>'}</table>

  <div class="section-title">NUTRITION PLAN</div>
  ${nutritionContent}

  ${plan.notes ? `<div class="notes"><p><strong>Coach's Note:</strong> ${plan.notes}</p></div>` : ''}

  <div class="footer">
    <p>FITNESS BY MADDY &middot; fitnessbymaddy.com &middot; Confidential</p>
  </div>
</body>
</html>`;
}
