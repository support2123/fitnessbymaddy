const { getSupabase } = require('../lib/supabase');
const { sendText, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 800', 'below 1000', 'starvation',
  'clenbuterol', 'dnp', 'dinitrophenol', 'ephedra', 'anabolic steroid',
  'sarm', 'growth hormone', 'hgh', 'testosterone injection',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

function hasSafetyRisk(text) {
  const lower = (text || '').toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }
  return null;
}

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

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lead } = client.lead_id
      ? await db.from('leads').select('first_msg').eq('id', client.lead_id).single()
      : { data: null };

    const intakeData = lead?.first_msg || '{}';
    let intake;
    try { intake = JSON.parse(intakeData); } catch { intake = { raw: intakeData }; }

    const prompt = buildPrompt(client, intake, recentCheckins, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const generatedText = response.content[0].text;

    const risk = hasSafetyRisk(generatedText);
    if (risk) {
      const { notifyMaddy } = require('../lib/whatsapp');
      await notifyMaddy(
        'Risky program content flagged',
        `Client: ${maskPhone(client.phone)}\nWeek: ${week_no}\nFlag: ${risk}`
      );
      return res.status(200).json({ ok: false, flagged: true, reason: risk });
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const parsed = JSON.parse(generatedText);
      workoutPlan = parsed.workout_plan || parsed.workout || {};
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition || {};
      notes = parsed.notes || parsed.coach_notes || '';
    } catch {
      workoutPlan = { raw: generatedText };
      nutritionPlan = {};
      notes = '';
    }

    const pdfContent = renderProgramPdf(client, week_no, workoutPlan, nutritionPlan, notes);
    const pdfPath = `${client_id}/week_${week_no}.pdf`;

    await db.storage.from('clients').upload(pdfPath, Buffer.from(pdfContent), {
      contentType: 'text/html',
      upsert: true,
    });

    const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);

    await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: urlData?.publicUrl || pdfPath,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes,
    });

    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);

    const msg = hinglish
      ? `Week ${week_no} ka program ready hai! 🔥 Check karo aur questions ho toh poochho.`
      : `Your Week ${week_no} program is ready! 🔥 Check it out and let us know if you have questions.`;

    await sendText(client.phone, msg);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, week_no, pdf_url: urlData?.publicUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const checkinSummary = (checkins || []).map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
  ).join('\n');

  return `You are a program architect for FitnessByMaddy, an elite online coaching brand.

Generate a detailed Week ${weekNo} training and nutrition plan for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Goal: ${intake.goal || 'general fitness'}
- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Current weight: ${intake.current_weight || 'unknown'}
- Target weight: ${intake.target_weight || 'unknown'}
- Experience: ${intake.experience_level || 'intermediate'}
- Injuries: ${intake.injuries || 'none'}
- Diet preference: ${intake.diet_pref || 'no restrictions'}
- Schedule: ${intake.schedule || 'flexible'}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins'}

RULES:
- Never prescribe extreme calorie deficits (minimum 1200 cal for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Never promise unrealistic timelines
- Be specific: sets, reps, rest periods, exact meal portions
- Progressive overload from previous week where applicable

OUTPUT FORMAT (JSON):
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }] }
    ],
    "cardio": "...",
    "rest_days": "..."
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fat_g": 0,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "hydration": "...",
    "supplements": ["..."]
  },
  "notes": "Coach notes for the week"
}`;
}

function renderProgramPdf(client, weekNo, workout, nutrition, notes) {
  const days = workout.days || [];
  const meals = nutrition.meals || [];

  let exerciseHtml = '';
  for (const day of days) {
    exerciseHtml += `<div class="day-block">
      <h3>${day.day} — ${day.focus || ''}</h3>
      <table><tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th></tr>`;
    for (const ex of (day.exercises || [])) {
      exerciseHtml += `<tr><td>${ex.name}</td><td>${ex.sets}</td><td>${ex.reps}</td><td>${ex.rest || '-'}</td></tr>`;
    }
    exerciseHtml += '</table></div>';
  }

  let mealHtml = '';
  for (const meal of meals) {
    mealHtml += `<div class="meal-block"><h4>${meal.meal}</h4><ul>`;
    for (const opt of (meal.options || [])) {
      mealHtml += `<li>${opt}</li>`;
    }
    mealHtml += '</ul></div>';
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #FAF8F4; padding: 40px; }
  .header { text-align: center; padding: 40px 0; border-bottom: 2px solid #B8965A; margin-bottom: 32px; }
  .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #B8965A; letter-spacing: 4px; }
  .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #FAF8F4; letter-spacing: 2px; margin-top: 8px; }
  .header p { color: #888; font-size: 14px; margin-top: 8px; }
  .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 24px; color: #B8965A; letter-spacing: 2px; margin: 32px 0 16px; border-bottom: 1px solid #333; padding-bottom: 8px; }
  .day-block { background: #222; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
  .day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 20px; color: #D4AF7A; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 8px; color: #B8965A; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #333; }
  td { padding: 8px; font-size: 14px; border-bottom: 1px solid #2a2a2a; }
  .macros { display: flex; gap: 24px; margin: 16px 0; }
  .macro-box { background: #222; border-radius: 8px; padding: 16px 24px; text-align: center; flex: 1; }
  .macro-num { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; }
  .macro-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
  .meal-block { background: #222; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
  .meal-block h4 { color: #D4AF7A; font-size: 14px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px; }
  .meal-block li { font-size: 14px; padding: 4px 0; margin-left: 16px; }
  .notes { background: #222; border-left: 3px solid #B8965A; padding: 16px 20px; margin-top: 24px; font-style: italic; color: #ccc; }
  .footer { text-align: center; margin-top: 40px; padding-top: 24px; border-top: 1px solid #333; color: #555; font-size: 12px; }
</style>
</head>
<body>
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <h2>WEEK ${weekNo} PROGRAM</h2>
    <p>${client.name || 'Client'} · ${client.program?.replace('_', ' ').toUpperCase()}</p>
  </div>

  <div class="section-title">WORKOUT PLAN</div>
  ${exerciseHtml}
  ${workout.cardio ? `<p style="margin-top:12px;color:#ccc">Cardio: ${workout.cardio}</p>` : ''}
  ${workout.rest_days ? `<p style="color:#888;margin-top:4px">Rest days: ${workout.rest_days}</p>` : ''}

  <div class="section-title">NUTRITION PLAN</div>
  <div class="macros">
    <div class="macro-box"><div class="macro-num">${nutrition.calories || '-'}</div><div class="macro-label">Calories</div></div>
    <div class="macro-box"><div class="macro-num">${nutrition.protein_g || '-'}g</div><div class="macro-label">Protein</div></div>
    <div class="macro-box"><div class="macro-num">${nutrition.carbs_g || '-'}g</div><div class="macro-label">Carbs</div></div>
    <div class="macro-box"><div class="macro-num">${nutrition.fat_g || '-'}g</div><div class="macro-label">Fat</div></div>
  </div>
  ${mealHtml}
  ${nutrition.hydration ? `<p style="margin-top:12px;color:#ccc">Hydration: ${nutrition.hydration}</p>` : ''}

  ${notes ? `<div class="section-title">COACH NOTES</div><div class="notes">${notes}</div>` : ''}

  <div class="footer">
    <p>FITNESS BY MADDY · fitnessbymaddy.com</p>
    <p style="margin-top:4px">This program is personalised. Do not share.</p>
  </div>
</body>
</html>`;
}
