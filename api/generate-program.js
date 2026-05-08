const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate, maskPhone, detectMarket, isHinglish } = require('./lib/whatsapp');
const { logMessage } = require('./lib/rate-limit');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedra/i,
  /anabolic/i,
  /steroid/i,
  /10\s*kg.*week/i,
  /20\s*lbs.*week/i,
];

function hasRiskyContent(text) {
  return RISKY_PATTERNS.some(p => p.test(text));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { client_id, week_no } = req.body || {};
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

  const { data: lead } = client.lead_id
    ? await db.from('leads').select('first_msg').eq('id', client.lead_id).single()
    : { data: null };

  const clientProfile = {
    name: client.name,
    program: client.program,
    week: week_no,
    totalWeeks: client.program === '12wk' ? 12 : 6,
    paidAmount: client.paid_amount,
    startDate: client.program_started_at,
    intakeData: lead?.first_msg || 'No intake data',
  };

  const checkinSummary = (recentCheckins || []).map(c => ({
    week: c.week_no,
    weight: c.weight,
    waist: c.waist,
    compliance: c.compliance_score,
    energy: c.energy,
    issues: c.issues,
  }));

  const anthropic = new Anthropic();

  const systemPrompt = `You are Maddy's program architect — an expert fitness coach assistant. Generate a weekly training and nutrition program for a client.

RULES:
- Programs must be evidence-based, safe, and progressive
- Never prescribe below 1400 calories for women or 1600 for men
- Never recommend banned substances or extreme protocols
- If the client reported pain/injury, adjust exercises to avoid aggravation
- Include warm-up and cooldown in every session
- Nutrition should include macros (protein/carbs/fat) and meal timing
- Be specific: exercise name, sets, reps, rest periods, RPE
- Output valid JSON with keys: workout_plan, nutrition_plan, notes

OUTPUT FORMAT (JSON only, no markdown):
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Barbell Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "rpe": 7 }
        ],
        "warmup": "5 min incline walk + arm circles",
        "cooldown": "5 min stretching"
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "time": "8:00 AM", "description": "..." }
    ],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein", "Creatine 5g"]
  },
  "notes": "One-liner context for the client about this week's focus"
}`;

  const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
${JSON.stringify(clientProfile, null, 2)}

RECENT CHECK-INS:
${JSON.stringify(checkinSummary, null, 2)}

Based on their progress, create an appropriate Week ${week_no} plan. Adjust intensity and volume based on compliance and energy scores. If issues were reported, modify accordingly.`;

  let result;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    result = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('Claude API error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }

  const fullText = JSON.stringify(result);
  if (hasRiskyContent(fullText)) {
    const { sendTemplate: notifyMaddy } = require('./lib/whatsapp');
    await notifyMaddy('917082478374', 'admin_escalation', [
      `⚠️ RISKY PROGRAM FLAGGED\nClient: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nReview before sending.`,
    ]);
    await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: result.workout_plan || {},
      nutrition_plan: result.nutrition_plan || {},
      notes: `FLAGGED FOR REVIEW: ${result.notes || ''}`,
      pdf_url: null,
    });
    return res.status(200).json({ flagged: true, reason: 'Risky content detected' });
  }

  const pdfHtml = renderProgramPdf(client, week_no, result);
  const pdfFileName = `week_${week_no}.html`;
  const storagePath = `${client.folder_url || `clients/${client_id}`}/${pdfFileName}`;

  const { error: uploadError } = await db.storage
    .from('programs')
    .upload(storagePath, Buffer.from(pdfHtml), {
      contentType: 'text/html',
      upsert: true,
    });

  const pdfUrl = uploadError
    ? null
    : `${process.env.SUPABASE_URL}/storage/v1/object/public/programs/${storagePath}`;

  await db.from('programs').insert({
    client_id,
    week_no,
    workout_plan: result.workout_plan || {},
    nutrition_plan: result.nutrition_plan || {},
    notes: result.notes || '',
    pdf_url: pdfUrl,
    generated_at: new Date().toISOString(),
  });

  if (pdfUrl) {
    const market = detectMarket(client.phone);
    const templateName = isHinglish(market) ? 'weekly_program_hi' : 'weekly_program';
    await sendTemplate(client.phone, templateName, [
      client.name || 'there',
      `Week ${week_no}`,
      result.notes || 'Your new program is ready!',
      pdfUrl,
    ]);
    await logMessage(client.phone, 'out', `Week ${week_no} program sent`, templateName);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('client_id', client_id).eq('week_no', week_no);
  }

  return res.status(200).json({ success: true, week_no, pdf_url: pdfUrl });
};

function renderProgramPdf(client, weekNo, plan) {
  const workout = plan.workout_plan || {};
  const nutrition = plan.nutrition_plan || {};
  const days = (workout.days || []).map(d => `
    <div class="day-card">
      <div class="day-header">${d.day} — ${d.focus}</div>
      <div class="warmup">Warm-up: ${d.warmup || 'General warm-up'}</div>
      <table>
        <tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th><th>RPE</th></tr>
        ${(d.exercises || []).map(e => `
          <tr>
            <td>${e.name}</td><td>${e.sets}</td><td>${e.reps}</td>
            <td>${e.rest || '-'}</td><td>${e.rpe || '-'}</td>
          </tr>
        `).join('')}
      </table>
      <div class="cooldown">Cool-down: ${d.cooldown || 'Stretch 5 min'}</div>
    </div>
  `).join('');

  const meals = (nutrition.meals || []).map(m => `
    <div class="meal">
      <strong>${m.meal}</strong> (${m.time || ''})<br>${m.description || ''}
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #fff; padding: 40px 24px; }
  .header { text-align: center; margin-bottom: 48px; padding-bottom: 24px; border-bottom: 2px solid #B8965A; }
  .brand { font-family: 'Bebas Neue', sans-serif; font-size: 14px; letter-spacing: 6px; color: #B8965A; text-transform: uppercase; }
  h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; letter-spacing: 4px; color: #fff; margin: 8px 0; }
  .subtitle { font-size: 14px; color: #888; }
  .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 28px; letter-spacing: 3px; color: #B8965A; margin: 32px 0 16px; }
  .day-card { background: #222; border-radius: 8px; padding: 24px; margin-bottom: 16px; border-left: 3px solid #B8965A; }
  .day-header { font-family: 'Bebas Neue', sans-serif; font-size: 22px; letter-spacing: 2px; color: #fff; margin-bottom: 12px; }
  .warmup, .cooldown { font-size: 13px; color: #B8965A; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th { text-align: left; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #888; padding: 8px 12px; border-bottom: 1px solid #333; }
  td { font-size: 14px; padding: 10px 12px; border-bottom: 1px solid #2a2a2a; color: #ddd; }
  .nutrition-box { background: #222; border-radius: 8px; padding: 24px; margin-bottom: 16px; }
  .macros { display: flex; gap: 24px; margin: 16px 0; flex-wrap: wrap; }
  .macro { text-align: center; }
  .macro-val { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; }
  .macro-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
  .meal { padding: 12px 0; border-bottom: 1px solid #2a2a2a; font-size: 14px; color: #ccc; }
  .notes { background: #B8965A; color: #1a1a1a; padding: 20px 24px; border-radius: 8px; margin-top: 32px; font-size: 15px; font-weight: 500; }
  .footer { text-align: center; margin-top: 48px; font-size: 12px; color: #555; }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">Fitness by Maddy</div>
    <h1>WEEK ${weekNo} PROGRAM</h1>
    <div class="subtitle">${client.name || 'Client'} · ${client.program || 'Custom'} Program</div>
  </div>

  <div class="section-title">WORKOUT PLAN</div>
  ${days}

  <div class="section-title">NUTRITION PLAN</div>
  <div class="nutrition-box">
    <div class="macros">
      <div class="macro"><div class="macro-val">${nutrition.calories || '-'}</div><div class="macro-label">Calories</div></div>
      <div class="macro"><div class="macro-val">${nutrition.protein_g || '-'}g</div><div class="macro-label">Protein</div></div>
      <div class="macro"><div class="macro-val">${nutrition.carbs_g || '-'}g</div><div class="macro-label">Carbs</div></div>
      <div class="macro"><div class="macro-val">${nutrition.fat_g || '-'}g</div><div class="macro-label">Fat</div></div>
    </div>
    ${meals}
    <div class="meal"><strong>Hydration:</strong> ${nutrition.hydration || '3-4L water daily'}</div>
    ${nutrition.supplements ? `<div class="meal"><strong>Supplements:</strong> ${nutrition.supplements.join(', ')}</div>` : ''}
  </div>

  ${plan.notes ? `<div class="notes">📝 ${plan.notes}</div>` : ''}

  <div class="footer">
    © Fitness by Maddy · fitnessbymaddy.com · This program is for personal use only.
  </div>
</body>
</html>`;
}
