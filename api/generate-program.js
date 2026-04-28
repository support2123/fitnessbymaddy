const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { sendText, escalateToMaddy, maskPhone } = require('./lib/whatsapp');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'anavar', 'steroid',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: intake } = await db
      .from('lead_intake')
      .select('*')
      .eq('lead_id', client.lead_id)
      .single();

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic();

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy. You create safe, science-backed, personalized weekly workout and nutrition plans.

RULES:
- Never prescribe banned substances or supplements requiring medical supervision
- Minimum calorie intake: 1200 for women, 1500 for men
- Never promise specific weight loss timelines
- Consider injuries and medical conditions seriously
- If anything is unclear or risky, flag it in the "safety_notes" field

OUTPUT FORMAT (JSON only):
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "notes": "" }] }
    ],
    "rest_days": ["Sunday"],
    "notes": ""
  },
  "nutrition_plan": {
    "daily_calories": 1800,
    "protein_g": 120,
    "carbs_g": 200,
    "fat_g": 60,
    "meal_timing": ["..."],
    "sample_meals": { "breakfast": "...", "lunch": "...", "dinner": "...", "snacks": "..." },
    "notes": ""
  },
  "weekly_focus": "...",
  "safety_notes": ""
}`;

    const userPrompt = buildUserPrompt(client, intake, recentCheckins, week_no);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = message.content[0].text;
    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse program JSON');
      return res.status(500).json({ error: 'Failed to parse generated program' });
    }

    const fullText = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => fullText.includes(flag));
    if (flagged || (programData.safety_notes && programData.safety_notes.trim())) {
      await escalateToMaddy(
        client.phone,
        'Safety flag in generated program',
        programData.safety_notes || 'Auto-flagged content detected'
      );
      await db.from('programs').insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        pdf_url: null,
        whatsapp_sent_at: null,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: `FLAGGED: ${programData.safety_notes || 'Auto-safety flag'}`,
      });
      return res.status(200).json({ status: 'flagged_for_review' });
    }

    const pdfHtml = renderProgramPdf(client, programData, week_no);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await db.storage.from('programs').upload(pdfPath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true,
    });

    const { data: urlData } = db.storage.from('programs').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { error: insertErr } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      whatsapp_sent_at: new Date().toISOString(),
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.weekly_focus || null,
    });

    if (insertErr) {
      console.error('Program insert error:', insertErr.message);
    }

    const market = client.phone?.startsWith('+91') ? 'IN' : 'GLOBAL';
    const msg = market === 'IN'
      ? `Week ${week_no} ka plan ready hai! Focus: ${programData.weekly_focus || 'Progressive overload'}\n\nPlan: ${pdfUrl}`
      : `Your Week ${week_no} plan is ready! Focus: ${programData.weekly_focus || 'Progressive overload'}\n\nPlan: ${pdfUrl}`;

    await sendText(client.phone, msg);

    return res.status(200).json({ status: 'ok', pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildUserPrompt(client, intake, checkins, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Program: ${client.program}\n`;
  prompt += `Name: ${client.name}\n`;

  if (intake) {
    prompt += `Age: ${intake.age || 'unknown'}\n`;
    prompt += `Goal: ${intake.goal || 'general fitness'}\n`;
    prompt += `Injuries: ${intake.injuries || 'none reported'}\n`;
    prompt += `Diet preference: ${intake.diet_pref || 'no preference'}\n`;
    prompt += `Schedule: ${intake.schedule || 'flexible'}\n`;
    prompt += `Medical conditions: ${intake.medical_conditions || 'none reported'}\n`;
  }

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent check-ins:\n`;
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, `;
      prompt += `Compliance ${c.compliance_score || '?'}/10, Energy ${c.energy || '?'}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      prompt += `\n`;
    }
  }

  if (weekNo > 1) {
    prompt += `\nThis is Week ${weekNo} — progressively increase intensity from the previous week.`;
  }

  return prompt;
}

function renderProgramPdf(client, data, weekNo) {
  const wp = data.workout_plan;
  const np = data.nutrition_plan;

  let daysHtml = '';
  if (wp.days) {
    for (const day of wp.days) {
      let exercisesHtml = '';
      if (day.exercises) {
        for (const ex of day.exercises) {
          exercisesHtml += `<tr><td>${ex.name}</td><td>${ex.sets}x${ex.reps}</td><td>${ex.notes || ''}</td></tr>`;
        }
      }
      daysHtml += `
        <div class="day-block">
          <h3>${day.day} — ${day.focus}</h3>
          <table><thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Notes</th></tr></thead>
          <tbody>${exercisesHtml}</tbody></table>
        </div>`;
    }
  }

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Week ${weekNo} Program — ${client.name}</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#1a1a1a;color:#FAF8F4;padding:40px 24px}
h1,h2,h3{font-family:'Bebas Neue',sans-serif;letter-spacing:2px}
h1{font-size:48px;color:#B8965A;margin-bottom:8px}
h2{font-size:28px;color:#D4AF7A;margin:32px 0 16px;border-bottom:1px solid #333;padding-bottom:8px}
h3{font-size:20px;color:#B8965A;margin-bottom:12px}
.header{text-align:center;padding:32px 0;border-bottom:2px solid #B8965A;margin-bottom:32px}
.subtitle{font-size:14px;color:#888;letter-spacing:3px;text-transform:uppercase}
.day-block{background:#222;border-radius:8px;padding:24px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;margin-top:8px}
th,td{text-align:left;padding:10px 12px;font-size:14px;border-bottom:1px solid #333}
th{color:#B8965A;font-size:12px;text-transform:uppercase;letter-spacing:1px}
.nutrition{background:#222;border-radius:8px;padding:24px;margin-bottom:16px}
.macro-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:16px 0}
.macro{text-align:center;background:#1a1a1a;padding:16px;border-radius:8px}
.macro-val{font-family:'Bebas Neue',sans-serif;font-size:36px;color:#B8965A}
.macro-label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-top:4px}
.meals{margin-top:16px}
.meals p{padding:8px 0;border-bottom:1px solid #333;font-size:14px;color:#ccc}
.meals strong{color:#D4AF7A}
.footer{text-align:center;margin-top:40px;padding-top:24px;border-top:1px solid #333;color:#555;font-size:12px}
@media(max-width:600px){.macro-grid{grid-template-columns:repeat(2,1fr)}h1{font-size:36px}}
</style></head><body>
<div class="header">
  <div class="subtitle">Fitness by Maddy</div>
  <h1>Week ${weekNo} Program</h1>
  <div class="subtitle">${client.name} · ${client.program}</div>
</div>
<h2>Workout Plan</h2>
${daysHtml}
${wp.rest_days ? `<p style="color:#888;margin:16px 0">Rest days: ${wp.rest_days.join(', ')}</p>` : ''}
${wp.notes ? `<p style="color:#ccc;margin:16px 0">${wp.notes}</p>` : ''}
<h2>Nutrition Plan</h2>
<div class="nutrition">
  <div class="macro-grid">
    <div class="macro"><div class="macro-val">${np.daily_calories || '—'}</div><div class="macro-label">Calories</div></div>
    <div class="macro"><div class="macro-val">${np.protein_g || '—'}g</div><div class="macro-label">Protein</div></div>
    <div class="macro"><div class="macro-val">${np.carbs_g || '—'}g</div><div class="macro-label">Carbs</div></div>
    <div class="macro"><div class="macro-val">${np.fat_g || '—'}g</div><div class="macro-label">Fat</div></div>
  </div>
  <div class="meals">
    ${np.sample_meals ? `
    <p><strong>Breakfast:</strong> ${np.sample_meals.breakfast || '—'}</p>
    <p><strong>Lunch:</strong> ${np.sample_meals.lunch || '—'}</p>
    <p><strong>Dinner:</strong> ${np.sample_meals.dinner || '—'}</p>
    <p><strong>Snacks:</strong> ${np.sample_meals.snacks || '—'}</p>
    ` : ''}
  </div>
  ${np.notes ? `<p style="color:#ccc;margin-top:16px">${np.notes}</p>` : ''}
</div>
${data.weekly_focus ? `<h2>This Week's Focus</h2><p style="color:#ccc;font-size:16px;line-height:1.6">${data.weekly_focus}</p>` : ''}
<div class="footer">
  <p>Fitness by Maddy · fitnessbymaddy.com</p>
  <p>Generated ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
</div>
</body></html>`;
}
