const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { logMessage } = require('../lib/rate-limit');
const { detectMarket, isHinglish } = require('../lib/market');
const Anthropic = require('@anthropic-ai/sdk');

const RISKY_PATTERNS = [
  /below\s*1[0-2]00\s*cal/i,
  /under\s*1[0-2]00\s*cal/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedrine/i,
  /steroids?/i,
  /anabolic/i,
  /lose\s+\d{2,}\s*(kg|lb|pound).*week/i,
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

  const { data: intake } = await supabase
    .from('intake_responses')
    .select('*')
    .eq('lead_id', client.lead_id)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .single();

  const { data: recentCheckins } = await supabase
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const systemPrompt = `You are Maddy's program architect — an elite NASM-certified fitness coach assistant.
You create personalized weekly workout and nutrition plans.
Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }
      ]},
      ...
    ],
    "cardio": { "type": "...", "duration": "...", "frequency": "..." }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["...", "..."] },
      ...
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "weekly_note": "A 1-2 sentence motivational + tactical note for the client"
}

Rules:
- Never recommend below 1200 calories for women or 1500 for men
- Never recommend banned substances, steroids, or extreme protocols
- Base progressions on the client's recent check-in data
- Account for injuries, medical conditions, and dietary preferences
- Keep it practical for the client's available equipment and schedule`;

  const userPrompt = buildUserPrompt(client, intake, recentCheckins, week_no);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const rawContent = response.content[0].text;

  for (const pattern of RISKY_PATTERNS) {
    if (pattern.test(rawContent)) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy(
        `Program generation flagged risky content (week ${week_no}): matched ${pattern}`,
        client
      );
      return res.status(200).json({
        ok: false,
        flagged: true,
        reason: 'Content flagged for Maddy review',
      });
    }
  }

  let programData;
  try {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    programData = JSON.parse(jsonMatch[0]);
  } catch {
    return res.status(500).json({ error: 'Failed to parse program JSON' });
  }

  const htmlPdf = renderProgramHTML(client, programData, week_no);
  const pdfPath = `clients/${client_id}/week_${week_no}.html`;
  await supabase.storage
    .from('client-files')
    .upload(pdfPath, new TextEncoder().encode(htmlPdf), {
      contentType: 'text/html',
      upsert: true,
    });

  const { data: urlData } = supabase.storage
    .from('client-files')
    .getPublicUrl(pdfPath);
  const pdfUrl = urlData?.publicUrl || '';

  await supabase.from('programs').insert({
    client_id,
    week_no: parseInt(week_no),
    generated_at: new Date().toISOString(),
    pdf_url: pdfUrl,
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: programData.weekly_note || null,
  });

  const market = detectMarket(client.phone);
  const hinglish = isHinglish(market);
  const templateName = hinglish ? 'weekly_program_hi' : 'weekly_program_en';

  await sendTemplate(client.phone, templateName, [
    client.name || 'there',
    `Week ${week_no}`,
    programData.weekly_note || 'Your new program is ready!',
  ]);
  await logMessage(
    client.phone, 'out',
    `[template:${templateName}] Week ${week_no} program`,
    templateName
  );

  await supabase
    .from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('client_id', client_id)
    .eq('week_no', parseInt(week_no));

  return res.status(200).json({ ok: true, pdf_url: pdfUrl });
};

function buildUserPrompt(client, intake, checkins, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${client.program}\n`;

  if (intake) {
    prompt += `Age: ${intake.age || 'Unknown'}\n`;
    prompt += `Gender: ${intake.gender || 'Unknown'}\n`;
    prompt += `Goal: ${intake.goal || 'General fitness'}\n`;
    prompt += `Injuries: ${intake.injuries || 'None reported'}\n`;
    prompt += `Diet preference: ${intake.diet_preference || 'No preference'}\n`;
    prompt += `Schedule: ${intake.schedule || 'Flexible'}\n`;
    prompt += `Experience: ${intake.experience_level || 'Intermediate'}\n`;
    prompt += `Medical: ${intake.medical_conditions || 'None'}\n`;
  }

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent check-ins:\n`;
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: weight=${c.weight || '?'}kg, `;
      prompt += `waist=${c.waist || '?'}cm, compliance=${c.compliance_score}/10, `;
      prompt += `energy=${c.energy}/10`;
      if (c.issues) prompt += `, issues: ${c.issues}`;
      prompt += `\n`;
    }
  }

  if (weekNo > 1) {
    prompt += `\nThis is week ${weekNo} — progressively adjust from prior weeks. `;
    prompt += `If compliance was low, simplify. If energy was high and compliance good, increase intensity slightly.`;
  }

  return prompt;
}

function renderProgramHTML(client, program, weekNo) {
  const workoutRows = (program.workout_plan?.days || []).map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr><td>${ex.name}</td><td>${ex.sets}×${ex.reps}</td><td>${ex.rest}</td><td>${ex.notes || ''}</td></tr>`
    ).join('');
    return `<div class="day-block">
      <h3>${day.day} — ${day.focus}</h3>
      <table><thead><tr><th>Exercise</th><th>Sets × Reps</th><th>Rest</th><th>Notes</th></tr></thead>
      <tbody>${exercises}</tbody></table>
    </div>`;
  }).join('');

  const meals = (program.nutrition_plan?.meals || []).map(m =>
    `<div class="meal"><strong>${m.meal}:</strong> ${(m.options || []).join(' | ')}</div>`
  ).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'DM Sans',sans-serif; background:#0a0a0a; color:#e0e0e0; padding:40px 24px; }
  .header { text-align:center; border-bottom:2px solid #B8965A; padding-bottom:32px; margin-bottom:40px; }
  .header h1 { font-family:'Bebas Neue',sans-serif; font-size:42px; color:#B8965A; letter-spacing:3px; }
  .header h2 { font-family:'Bebas Neue',sans-serif; font-size:24px; color:#fff; letter-spacing:2px; margin-top:8px; }
  .header p { color:#888; font-size:13px; margin-top:8px; }
  .section-title { font-family:'Bebas Neue',sans-serif; font-size:28px; color:#B8965A; letter-spacing:2px; margin:32px 0 16px; }
  .day-block { background:#151515; border:1px solid #222; border-radius:8px; padding:20px; margin-bottom:16px; }
  .day-block h3 { font-family:'Bebas Neue',sans-serif; font-size:20px; color:#fff; margin-bottom:12px; letter-spacing:1px; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#B8965A; padding:8px; border-bottom:1px solid #333; }
  td { padding:8px; font-size:13px; border-bottom:1px solid #1a1a1a; }
  .nutrition { background:#151515; border:1px solid #222; border-radius:8px; padding:24px; }
  .macros { display:flex; gap:20px; flex-wrap:wrap; margin-bottom:20px; }
  .macro { background:#1a1a1a; padding:16px; border-radius:6px; text-align:center; flex:1; min-width:80px; }
  .macro-val { font-family:'Bebas Neue',sans-serif; font-size:28px; color:#B8965A; }
  .macro-label { font-size:11px; color:#888; text-transform:uppercase; letter-spacing:1px; }
  .meal { padding:10px 0; border-bottom:1px solid #1a1a1a; font-size:14px; }
  .note { background:#1a1a0a; border:1px solid #B8965A33; border-radius:8px; padding:20px; margin-top:32px; font-style:italic; color:#B8965A; }
  .footer { text-align:center; margin-top:48px; padding-top:24px; border-top:1px solid #222; color:#444; font-size:12px; }
</style></head><body>
<div class="header">
  <h1>FITNESS BY MADDY</h1>
  <h2>WEEK ${weekNo} PROGRAM</h2>
  <p>${client.name || 'Client'} · ${client.program?.replace(/_/g, ' ').toUpperCase()}</p>
</div>
<h2 class="section-title">WORKOUT PLAN</h2>
${workoutRows}
${program.workout_plan?.cardio ? `<div class="day-block"><h3>Cardio</h3><p>${program.workout_plan.cardio.type} · ${program.workout_plan.cardio.duration} · ${program.workout_plan.cardio.frequency}</p></div>` : ''}
<h2 class="section-title">NUTRITION PLAN</h2>
<div class="nutrition">
  <div class="macros">
    <div class="macro"><div class="macro-val">${program.nutrition_plan?.calories || '—'}</div><div class="macro-label">Calories</div></div>
    <div class="macro"><div class="macro-val">${program.nutrition_plan?.protein_g || '—'}g</div><div class="macro-label">Protein</div></div>
    <div class="macro"><div class="macro-val">${program.nutrition_plan?.carbs_g || '—'}g</div><div class="macro-label">Carbs</div></div>
    <div class="macro"><div class="macro-val">${program.nutrition_plan?.fat_g || '—'}g</div><div class="macro-label">Fat</div></div>
  </div>
  ${meals}
  ${program.nutrition_plan?.hydration ? `<div class="meal"><strong>Hydration:</strong> ${program.nutrition_plan.hydration}</div>` : ''}
</div>
${program.weekly_note ? `<div class="note">"${program.weekly_note}"</div>` : ''}
<div class="footer">© Fitness by Maddy · fitnessbymaddy.com</div>
</body></html>`;
}
