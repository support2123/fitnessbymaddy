const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone } = require('./lib/whatsapp');

const RISKY_PATTERNS = [
  /below\s*\d{3,4}\s*cal/i,
  /under\s*800\s*cal/i,
  /starvation/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedrine/i,
  /anabolic/i,
  /steroid/i,
  /lose\s*\d+\s*kg\s*in\s*(1|2|3)\s*day/i,
  /crash\s*diet/i
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  try {
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: profile } = await db
      .from('intake_profiles')
      .select('*')
      .eq('lead_id', client.lead_id)
      .single();

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .eq('week_no', week_no - 1)
      .single();

    const anthropic = new Anthropic();

    const systemPrompt = `You are Maddy's AI program architect for Fitness by Maddy.
You create personalized weekly workout and nutrition plans for clients.

RULES:
- Be evidence-based: no bro-science, no extreme approaches
- Minimum 1200 calories for women, 1500 for men
- Never recommend banned substances or extreme protocols
- Consider injuries, medical conditions, and preferences
- Progressive overload: slightly advance from previous week
- Be specific: exact exercises, sets, reps, rest periods
- Nutrition: macros, meal timing, hydration, supplements (basic only)
- Include a motivational note personalized to the client's journey

OUTPUT FORMAT: Return valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "20 min LISS post-workout"
      }
    ],
    "deload_notes": ""
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fat_g": 60,
    "meals": [
      { "meal": "Breakfast", "options": ["Option A description", "Option B description"] }
    ],
    "hydration": "3L minimum",
    "supplements": ["Whey protein", "Creatine 5g"],
    "notes": ""
  },
  "weekly_note": "Personal motivational message for this week"
}`;

    const userPrompt = buildClientContext(client, profile, recentCheckins, prevProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawContent = response.content[0].text;
    let programData;

    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      programData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('Program parse error:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const contentStr = JSON.stringify(programData);
    const isRisky = RISKY_PATTERNS.some(p => p.test(contentStr));
    if (isRisky) {
      const { escalateToMaddy } = require('./lib/whatsapp');
      await escalateToMaddy(
        client.phone,
        `Week ${week_no} program flagged for review`,
        'Risky content detected in generated program'
      );
      return res.status(200).json({
        success: false,
        reason: 'flagged_for_review',
        message: 'Program contains potentially risky content — sent to Maddy for review'
      });
    }

    const pdfHtml = renderProgramPDF(client, programData, week_no);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await db.storage.from('programs').upload(pdfPath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true
    });

    const { data: urlData } = db.storage.from('programs').getPublicUrl(pdfPath);
    const pdfUrl = urlData.publicUrl;

    const { error: progErr } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.weekly_note || null
    });

    if (progErr) {
      console.error('Program save error:', progErr.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    await sendWhatsApp(client.phone, 'weekly_program', {
      name: client.name,
      templateParams: [
        client.name,
        week_no.toString(),
        programData.weekly_note || 'Your new program is ready!'
      ],
      media: { url: pdfUrl, filename: `Week_${week_no}_Program.html` }
    }, true);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ success: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error(`Program gen error for client ${client_id}:`, err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};

function buildClientContext(client, profile, checkins, prevProgram, weekNo) {
  let ctx = `Generate Week ${weekNo} program for:\n`;
  ctx += `Name: ${client.name}\n`;
  ctx += `Program: ${client.program}\n`;

  if (profile) {
    ctx += `Age: ${profile.age || 'unknown'}\n`;
    ctx += `Gender: ${profile.gender || 'unknown'}\n`;
    ctx += `Height: ${profile.height || 'unknown'}\n`;
    ctx += `Current Weight: ${profile.weight || 'unknown'}\n`;
    ctx += `Goal: ${profile.goal || 'general fitness'}\n`;
    ctx += `Injuries: ${profile.injuries || 'none reported'}\n`;
    ctx += `Diet Preference: ${profile.diet_pref || 'no preference'}\n`;
    ctx += `Schedule: ${profile.schedule || 'flexible'}\n`;
    ctx += `Experience: ${profile.experience_level || 'intermediate'}\n`;
    ctx += `Equipment: ${profile.equipment_access || 'full gym'}\n`;
    if (profile.medical_conditions) {
      ctx += `Medical: ${profile.medical_conditions}\n`;
    }
  }

  if (checkins && checkins.length > 0) {
    ctx += `\nRecent Check-ins:\n`;
    for (const c of checkins) {
      ctx += `  Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, `;
      ctx += `Compliance ${c.compliance_score}/10, Energy ${c.energy}/10`;
      if (c.issues) ctx += `, Issues: ${c.issues}`;
      ctx += `\n`;
    }
  }

  if (prevProgram) {
    ctx += `\nPrevious week plan summary available for progression reference.\n`;
  }

  return ctx;
}

function renderProgramPDF(client, data, weekNo) {
  const workout = data.workout_plan || {};
  const nutrition = data.nutrition_plan || {};
  const days = workout.days || [];

  let workoutHtml = '';
  for (const day of days) {
    workoutHtml += `
      <div class="day-card">
        <h3>${day.day} — ${day.focus}</h3>
        <table>
          <tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th></tr>
          ${(day.exercises || []).map(e =>
            `<tr><td>${e.name}</td><td>${e.sets}</td><td>${e.reps}</td><td>${e.rest}</td></tr>`
          ).join('')}
        </table>
        ${day.cardio ? `<p class="cardio">Cardio: ${day.cardio}</p>` : ''}
      </div>`;
  }

  let mealsHtml = '';
  for (const meal of (nutrition.meals || [])) {
    mealsHtml += `
      <div class="meal">
        <h4>${meal.meal}</h4>
        <ul>${(meal.options || []).map(o => `<li>${o}</li>`).join('')}</ul>
      </div>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'DM Sans',sans-serif; background:#1a1a1a; color:#fff; padding:20px; }
  .header { text-align:center; padding:40px 20px; border-bottom:2px solid #B8965A; margin-bottom:30px; }
  .header h1 { font-family:'Bebas Neue',sans-serif; font-size:42px; color:#B8965A; letter-spacing:4px; }
  .header h2 { font-family:'Bebas Neue',sans-serif; font-size:28px; color:#fff; letter-spacing:2px; margin-top:8px; }
  .header p { color:#999; font-size:14px; margin-top:8px; }
  .section-title { font-family:'Bebas Neue',sans-serif; font-size:24px; color:#B8965A; letter-spacing:2px; margin:30px 0 16px; padding-bottom:8px; border-bottom:1px solid #333; }
  .day-card { background:#222; border-radius:8px; padding:20px; margin-bottom:16px; border-left:3px solid #B8965A; }
  .day-card h3 { font-family:'Bebas Neue',sans-serif; font-size:20px; color:#B8965A; margin-bottom:12px; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#999; padding:8px 4px; border-bottom:1px solid #333; }
  td { padding:8px 4px; font-size:14px; color:#ddd; border-bottom:1px solid #2a2a2a; }
  .cardio { margin-top:12px; font-size:13px; color:#B8965A; font-style:italic; }
  .macros { display:flex; gap:16px; flex-wrap:wrap; margin:16px 0; }
  .macro-box { background:#222; border-radius:8px; padding:16px 20px; text-align:center; flex:1; min-width:100px; }
  .macro-box .num { font-family:'Bebas Neue',sans-serif; font-size:32px; color:#B8965A; }
  .macro-box .label { font-size:11px; color:#999; text-transform:uppercase; letter-spacing:1px; }
  .meal { background:#222; border-radius:8px; padding:16px; margin-bottom:12px; }
  .meal h4 { color:#B8965A; font-size:14px; margin-bottom:8px; }
  .meal ul { list-style:none; }
  .meal li { padding:4px 0; font-size:13px; color:#ccc; }
  .meal li::before { content:'→ '; color:#B8965A; }
  .note { background:linear-gradient(135deg,#2a2a1a,#1a1a1a); border:1px solid #B8965A; border-radius:8px; padding:24px; margin-top:30px; text-align:center; }
  .note p { font-style:italic; color:#ddd; font-size:16px; line-height:1.6; }
  .footer { text-align:center; padding:30px; margin-top:30px; border-top:1px solid #333; }
  .footer p { color:#666; font-size:12px; }
</style>
</head>
<body>
  <div class="header">
    <h1>Fitness by Maddy</h1>
    <h2>Week ${weekNo} Program</h2>
    <p>${client.name} · ${client.program.toUpperCase()}</p>
  </div>

  <div class="section-title">Workout Plan</div>
  ${workoutHtml}

  <div class="section-title">Nutrition Plan</div>
  <div class="macros">
    <div class="macro-box"><div class="num">${nutrition.calories || '—'}</div><div class="label">Calories</div></div>
    <div class="macro-box"><div class="num">${nutrition.protein_g || '—'}g</div><div class="label">Protein</div></div>
    <div class="macro-box"><div class="num">${nutrition.carbs_g || '—'}g</div><div class="label">Carbs</div></div>
    <div class="macro-box"><div class="num">${nutrition.fat_g || '—'}g</div><div class="label">Fat</div></div>
  </div>
  ${mealsHtml}
  ${nutrition.hydration ? `<p style="color:#999;font-size:13px;margin-top:12px;">Hydration: ${nutrition.hydration}</p>` : ''}
  ${nutrition.supplements ? `<p style="color:#999;font-size:13px;">Supplements: ${nutrition.supplements.join(', ')}</p>` : ''}

  ${data.weekly_note ? `
  <div class="note">
    <p>"${data.weekly_note}"</p>
    <p style="color:#B8965A;font-size:13px;margin-top:12px;">— Maddy</p>
  </div>
  ` : ''}

  <div class="footer">
    <p>Fitness by Maddy · fitnessbymaddy.com</p>
  </div>
</body>
</html>`;
}
