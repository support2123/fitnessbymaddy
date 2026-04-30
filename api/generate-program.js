const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/masking');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000', 'under 800', 'starvation',
  'banned substance', 'steroid', 'ephedra', 'dnp', 'clenbuterol',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

    const { data: lead } = client.lead_id
      ? await db.from('leads').select('first_msg').eq('id', client.lead_id).single()
      : { data: null };

    const intakeData = lead?.first_msg ? tryParseJSON(lead.first_msg) : {};

    const prompt = buildPrompt(client, intakeData, recentCheckins || [], week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    const responseText = claudeData?.content?.[0]?.text || '';

    const hasSafetyFlag = SAFETY_FLAGS.some(flag =>
      responseText.toLowerCase().includes(flag)
    );

    if (hasSafetyFlag) {
      await escalateToMaddy({
        reason: 'Safety flag in generated program',
        phone: maskPhone(client.phone),
        message: `Week ${week_no} program flagged for review`,
      });
      return res.status(200).json({ ok: false, reason: 'safety_flagged' });
    }

    let workoutPlan, nutritionPlan;
    try {
      const parsed = JSON.parse(responseText);
      workoutPlan = parsed.workout_plan || parsed.workout || parsed;
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition || {};
    } catch {
      workoutPlan = { raw: responseText };
      nutritionPlan = {};
    }

    const pdfHtml = buildProgramPDF(client, week_no, workoutPlan, nutritionPlan);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await db.storage.from('programs').upload(pdfPath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true,
    });

    const { data: urlData } = db.storage.from('programs').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes: `Auto-generated for week ${week_no}`,
    }).select().single();

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      bodyValues: [client.name || 'there', String(week_no)],
      mediaUrl: pdfUrl,
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    return res.status(200).json({ ok: true, program_id: program.id });
  } catch (err) {
    console.error('generate-program error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  return `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand.

Generate a structured weekly program (Week ${weekNo}) for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Goal: ${intake.goal || 'general fitness'}
- Experience: ${intake.experience_level || 'intermediate'}
- Injuries/Limitations: ${intake.injuries || 'none reported'}
- Diet preference: ${intake.diet_pref || 'flexible'}
- Current weight: ${intake.current_weight || 'not provided'}
- Target weight: ${intake.target_weight || 'not provided'}
- Schedule: ${intake.schedule || '5 days/week'}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins (Week 1)'}

OUTPUT FORMAT (strict JSON):
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min incline walk + dynamic stretches",
        "cooldown": "5 min static stretching"
      }
    ],
    "rest_days": ["Sunday"],
    "weekly_notes": ""
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meal_timing": ["8am breakfast", "12pm lunch", "4pm pre-workout", "7pm dinner", "9pm casein"],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein", "Creatine 5g", "Vitamin D"],
    "notes": ""
  }
}

RULES:
- Never prescribe fewer than 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme approaches
- Progressive overload from previous weeks when check-in data available
- Adjust based on compliance score and energy levels
- If injuries reported, provide safe alternatives
- Output ONLY valid JSON, no markdown`;
}

function buildProgramPDF(client, weekNo, workout, nutrition) {
  const exerciseRows = (workout.days || []).map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr><td>${ex.name}</td><td>${ex.sets}x${ex.reps}</td><td>${ex.rest || '-'}</td><td>${ex.notes || ''}</td></tr>`
    ).join('');
    return `
      <div class="day-block">
        <h3>${day.day} — ${day.focus || ''}</h3>
        <p class="warmup">Warmup: ${day.warmup || 'General warmup'}</p>
        <table>
          <thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Notes</th></tr></thead>
          <tbody>${exercises}</tbody>
        </table>
        <p class="cooldown">Cooldown: ${day.cooldown || 'Stretching'}</p>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', sans-serif; background: #111; color: #fff; padding: 40px; }
  .header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #B8965A; padding-bottom: 24px; }
  .header h1 { font-size: 36px; font-weight: 700; letter-spacing: 4px; text-transform: uppercase; color: #B8965A; }
  .header h2 { font-size: 18px; font-weight: 300; color: #ccc; margin-top: 8px; }
  .header p { font-size: 14px; color: #888; margin-top: 4px; }
  .section-title { font-size: 22px; font-weight: 700; color: #B8965A; letter-spacing: 3px; text-transform: uppercase; margin: 32px 0 16px; }
  .day-block { background: #1a1a1a; border: 1px solid #333; border-radius: 4px; padding: 20px; margin-bottom: 16px; }
  .day-block h3 { font-size: 16px; color: #B8965A; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px; }
  .warmup, .cooldown { font-size: 12px; color: #888; margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #333; font-size: 13px; }
  th { color: #B8965A; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
  .nutrition-box { background: #1a1a1a; border: 1px solid #333; border-radius: 4px; padding: 24px; margin-top: 16px; }
  .macro-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 16px 0; }
  .macro-item { text-align: center; }
  .macro-num { font-size: 28px; font-weight: 700; color: #B8965A; }
  .macro-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
  .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #333; font-size: 11px; color: #555; }
</style>
</head>
<body>
  <div class="header">
    <h1>Fitness by Maddy</h1>
    <h2>${client.name || 'Your'} — Week ${weekNo} Program</h2>
    <p>${client.program?.replace(/_/g, ' ').toUpperCase() || 'CUSTOM PROGRAM'}</p>
  </div>

  <div class="section-title">Workout Plan</div>
  ${exerciseRows || '<p style="color:#888">Program details loading...</p>'}

  <div class="section-title">Nutrition Plan</div>
  <div class="nutrition-box">
    <div class="macro-grid">
      <div class="macro-item"><div class="macro-num">${nutrition.calories || '—'}</div><div class="macro-label">Calories</div></div>
      <div class="macro-item"><div class="macro-num">${nutrition.protein_g || '—'}g</div><div class="macro-label">Protein</div></div>
      <div class="macro-item"><div class="macro-num">${nutrition.carbs_g || '—'}g</div><div class="macro-label">Carbs</div></div>
      <div class="macro-item"><div class="macro-num">${nutrition.fat_g || '—'}g</div><div class="macro-label">Fat</div></div>
    </div>
    <p style="font-size:13px; color:#ccc; margin-top:12px;">Hydration: ${nutrition.hydration || '3-4L water daily'}</p>
    <p style="font-size:13px; color:#ccc; margin-top:4px;">Supplements: ${(nutrition.supplements || []).join(', ') || 'As discussed'}</p>
  </div>

  <div class="footer">
    <p>FITNESS BY MADDY — fitnessbymaddy.com</p>
    <p>This program is personalised for ${client.name || 'you'}. Do not share or redistribute.</p>
  </div>
</body>
</html>`;
}

function tryParseJSON(str) {
  try { return JSON.parse(str); } catch { return {}; }
}
