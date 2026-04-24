const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalate');

const SAFETY_FLAGS = [
  'less than 1000 calories',
  'less than 800 calories',
  'extreme',
  'starvation',
  'clenbuterol',
  'dnp',
  'dinitrophenol',
  'ephedra',
  'anabolic steroid',
  'testosterone inject',
  'sarm',
  'lose 10 kg in 1 week',
  'lose 20 pounds in a week',
];

function hasSafetyFlag(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some((flag) => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const authHeader = req.headers['authorization'];
  if (
    authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}` &&
    req.headers['x-vercel-cron'] !== '1'
  ) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { client_id, week_no } = body;

    if (!client_id || !week_no) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({ error: 'client_id and week_no required' })
      );
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*, intake:intake_forms(*)')
      .eq('id', client_id)
      .single();

    if (!client) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Client not found' }));
    }

    const { data: intake } = await db
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are the Program Architect for FitnessByMaddy, an elite online fitness coaching brand.
You create personalized weekly workout and nutrition plans.

RULES:
- Never prescribe fewer than 1200 calories/day for women or 1500 for men
- Never recommend banned substances, SARMs, or anabolic steroids
- Never promise unrealistic timelines (e.g. "lose 10kg in 1 week")
- Plans must be progressive — build on the previous week
- Consider injuries, medical conditions, and equipment access
- Nutrition must respect diet preferences (veg, vegan, halal, etc.)
- Be specific: exact exercises, sets, reps, rest periods
- Include warm-up and cool-down in every workout

OUTPUT FORMAT: Return valid JSON only, no markdown fences.
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "warmup": "...",
        "exercises": [
          {"name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "..."}
        ],
        "cooldown": "..."
      }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 1800,
    "protein_g": 140,
    "carbs_g": 200,
    "fat_g": 60,
    "meals": [
      {"time": "8:00 AM", "name": "Breakfast", "items": ["..."], "calories": 450}
    ],
    "hydration": "3L water/day",
    "supplements": ["Whey protein", "Creatine 5g"]
  },
  "coach_note": "Short motivational note for the client"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${intake?.age || 'Unknown'}
- Gender: ${intake?.gender || 'Unknown'}
- Height: ${intake?.height_cm || 'Unknown'} cm
- Current Weight: ${intake?.current_weight || recentCheckins?.[0]?.weight || 'Unknown'} kg
- Goal Weight: ${intake?.goal_weight || 'Unknown'} kg
- Goal: ${intake?.goal || 'General fitness'}
- Injuries: ${intake?.injuries || 'None reported'}
- Medical Conditions: ${intake?.medical_conditions || 'None'}
- Diet Preference: ${intake?.diet_preference || 'No restriction'}
- Meals/Day: ${intake?.meals_per_day || 3}
- Experience: ${intake?.workout_experience || 'Beginner'}
- Days Available: ${intake?.days_available || 5}
- Equipment: ${intake?.equipment_access || 'Full gym'}
- Wake Time: ${intake?.wake_time || '7:00 AM'}

${recentCheckins?.length ? `RECENT CHECK-INS:
${recentCheckins.map((c) => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')}` : 'No previous check-ins (Week 1).'}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const aiText = response.content[0].text;

    if (hasSafetyFlag(aiText)) {
      await escalateToMaddy({
        reason: 'Safety flag in generated program',
        phone: client.phone,
        details: `Week ${week_no} program flagged for review. Client: ${client.name}`,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({
          ok: false,
          reason: 'safety_flagged',
          message: 'Program flagged for Maddy review',
        })
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(aiText);
    } catch {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse AI response as JSON');
      }
    }

    const pdfHtml = buildProgramPdfHtml(client, week_no, parsed);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');

    const filePath = `clients/${client.id}/week_${week_no}.html`;
    await db.storage.from('programs').upload(filePath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true,
    });

    const {
      data: { publicUrl },
    } = db.storage.from('programs').getPublicUrl(filePath);

    const { data: program } = await db
      .from('programs')
      .insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        pdf_url: publicUrl,
        workout_plan: parsed.workout_plan,
        nutrition_plan: parsed.nutrition_plan,
        notes: parsed.coach_note || null,
      })
      .select()
      .single();

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      bodyValues: [
        client.name || 'there',
        String(week_no),
        parsed.coach_note || 'Your new program is ready!',
      ],
      mediaUrl: publicUrl,
    });

    await db
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({ ok: true, program_id: program.id, pdf_url: publicUrl })
    );
  } catch (err) {
    console.error('Program generation error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};

function buildProgramPdfHtml(client, weekNo, plan) {
  const days = plan.workout_plan?.days || [];
  const nutrition = plan.nutrition_plan || {};
  const meals = nutrition.meals || [];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program - ${client.name || 'Client'}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #fff; padding: 40px 24px; }
.header { text-align: center; margin-bottom: 48px; padding-bottom: 24px; border-bottom: 2px solid #B8965A; }
.brand { font-family: 'Bebas Neue', sans-serif; font-size: 14px; letter-spacing: 6px; color: #B8965A; text-transform: uppercase; margin-bottom: 8px; }
h1 { font-family: 'Bebas Neue', sans-serif; font-size: 42px; letter-spacing: 3px; color: #fff; }
.week-badge { display: inline-block; background: #B8965A; color: #1a1a1a; padding: 6px 20px; font-size: 12px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; margin-top: 12px; }
.section-title { font-family: 'Bebas Neue', sans-serif; font-size: 28px; letter-spacing: 2px; color: #B8965A; margin: 40px 0 20px; padding-bottom: 8px; border-bottom: 1px solid #333; }
.day-card { background: #222; border-radius: 8px; padding: 24px; margin-bottom: 16px; border-left: 3px solid #B8965A; }
.day-name { font-family: 'Bebas Neue', sans-serif; font-size: 22px; letter-spacing: 2px; color: #B8965A; margin-bottom: 4px; }
.day-focus { font-size: 13px; color: #999; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 1px; }
.exercise { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #333; }
.exercise:last-child { border-bottom: none; }
.ex-name { font-weight: 500; font-size: 14px; }
.ex-detail { font-size: 12px; color: #B8965A; }
.warmup, .cooldown { font-size: 13px; color: #888; padding: 8px 0; font-style: italic; }
.nutrition-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 24px; }
.macro-card { background: #222; padding: 16px; border-radius: 8px; text-align: center; }
.macro-value { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; }
.macro-label { font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
.meal-card { background: #222; border-radius: 8px; padding: 20px; margin-bottom: 12px; }
.meal-time { font-size: 11px; color: #B8965A; letter-spacing: 1px; text-transform: uppercase; }
.meal-name { font-weight: 600; font-size: 16px; margin: 4px 0 8px; }
.meal-items { font-size: 13px; color: #ccc; line-height: 1.6; }
.meal-cal { font-size: 12px; color: #B8965A; margin-top: 8px; }
.coach-note { background: linear-gradient(135deg, #B8965A, #8B6914); border-radius: 8px; padding: 24px; margin-top: 40px; text-align: center; }
.coach-note p { font-size: 16px; font-style: italic; line-height: 1.6; color: #1a1a1a; font-weight: 500; }
.footer { text-align: center; margin-top: 48px; padding-top: 24px; border-top: 1px solid #333; }
.footer p { font-size: 11px; color: #666; letter-spacing: 2px; text-transform: uppercase; }
@media print { body { background: #1a1a1a; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<div class="header">
  <div class="brand">Fitness by Maddy</div>
  <h1>${client.name || 'Your'} Program</h1>
  <div class="week-badge">Week ${weekNo}</div>
</div>

<div class="section-title">Workout Plan</div>
${days.map((day) => `
<div class="day-card">
  <div class="day-name">${day.day}</div>
  <div class="day-focus">${day.focus || ''}</div>
  ${day.warmup ? `<div class="warmup">Warm-up: ${day.warmup}</div>` : ''}
  ${(day.exercises || []).map((ex) => `
  <div class="exercise">
    <span class="ex-name">${ex.name}</span>
    <span class="ex-detail">${ex.sets} x ${ex.reps} | Rest ${ex.rest || '60s'}</span>
  </div>`).join('')}
  ${day.cooldown ? `<div class="cooldown">Cool-down: ${day.cooldown}</div>` : ''}
</div>`).join('')}

<div class="section-title">Nutrition Plan</div>
<div class="nutrition-grid">
  <div class="macro-card"><div class="macro-value">${nutrition.daily_calories || '-'}</div><div class="macro-label">Calories</div></div>
  <div class="macro-card"><div class="macro-value">${nutrition.protein_g || '-'}g</div><div class="macro-label">Protein</div></div>
  <div class="macro-card"><div class="macro-value">${nutrition.carbs_g || '-'}g</div><div class="macro-label">Carbs</div></div>
  <div class="macro-card"><div class="macro-value">${nutrition.fat_g || '-'}g</div><div class="macro-label">Fat</div></div>
</div>

${meals.map((meal) => `
<div class="meal-card">
  <div class="meal-time">${meal.time || ''}</div>
  <div class="meal-name">${meal.name || 'Meal'}</div>
  <div class="meal-items">${(meal.items || []).join(' • ')}</div>
  ${meal.calories ? `<div class="meal-cal">${meal.calories} cal</div>` : ''}
</div>`).join('')}

${nutrition.hydration ? `<div class="meal-card"><div class="meal-time">Hydration</div><div class="meal-items">${nutrition.hydration}</div></div>` : ''}
${nutrition.supplements?.length ? `<div class="meal-card"><div class="meal-time">Supplements</div><div class="meal-items">${nutrition.supplements.join(' • ')}</div></div>` : ''}

${plan.coach_note ? `<div class="coach-note"><p>${plan.coach_note}</p></div>` : ''}

<div class="footer"><p>Fitness by Maddy &bull; fitnessbymaddy.com</p></div>
</body>
</html>`;
}
