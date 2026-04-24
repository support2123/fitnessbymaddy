const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/utils');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 1000 calories', 'very low calorie',
  'clenbuterol', 'dnp', 'dinitrophenol', 'ephedra', 'sarm',
  'steroid', 'anabolic', 'testosterone inject',
  'lose 10kg in 1 week', 'lose 20 pounds in',
  'starvation', 'water fast', '0 calorie',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    if (!client || client.status !== 'active') {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    let intakeData = null;
    try {
      const { data: intakeFile } = await db.storage
        .from('client-data')
        .download(`intakes/${client.lead_id}.json`);
      if (intakeFile) {
        const text = await intakeFile.text();
        intakeData = JSON.parse(text);
      }
    } catch (e) {
      console.log('No intake data found for client');
    }

    const prompt = buildProgramPrompt(client, recentCheckins, intakeData, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch (e) {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const fullText = JSON.stringify(parsed).toLowerCase();
    const flagged = SAFETY_FLAGS.some(f => fullText.includes(f));

    if (flagged) {
      await sendWhatsApp('+917082478374', 'escalation_alert', [
        maskPhone(client.phone),
        'unsafe_program_flagged',
        `Week ${week_no} program for ${client.name} flagged for safety review`,
      ]);

      await db.from('programs').insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        workout_plan: parsed.workout_plan || parsed.workout || null,
        nutrition_plan: parsed.nutrition_plan || parsed.nutrition || null,
        notes: 'FLAGGED FOR SAFETY REVIEW - NOT SENT',
      });

      return res.status(200).json({
        success: false,
        action: 'flagged_for_review',
        week_no,
      });
    }

    const pdfHtml = generateProgramPdfHtml(client, parsed, week_no);
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;
    await db.storage
      .from('client-data')
      .upload(pdfPath, pdfHtml, { contentType: 'text/html', upsert: true });

    const { data: pdfUrlData } = db.storage
      .from('client-data')
      .getPublicUrl(pdfPath);

    const { data: program } = await db
      .from('programs')
      .insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        pdf_url: pdfUrlData.publicUrl,
        workout_plan: parsed.workout_plan || parsed.workout || null,
        nutrition_plan: parsed.nutrition_plan || parsed.nutrition || null,
        notes: parsed.notes || parsed.coach_notes || null,
      })
      .select()
      .single();

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      pdfUrlData.publicUrl,
    ]);

    await db
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({
      success: true,
      program_id: program.id,
      week_no,
      pdf_url: pdfUrlData.publicUrl,
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildProgramPrompt(client, checkins, intake, weekNo) {
  const checkinSummary = checkins && checkins.length > 0
    ? checkins.map(c =>
        `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
      ).join('\n')
    : 'No previous check-ins available.';

  const intakeSummary = intake
    ? `Age: ${intake.age}, Gender: ${intake.gender}, Height: ${intake.height}, Current Weight: ${intake.weight}, Goal: ${intake.goal}, Injuries: ${intake.injuries || 'none'}, Diet: ${intake.diet_preference || 'flexible'}, Experience: ${intake.training_experience || 'beginner'}, Equipment: ${intake.equipment_access || 'full gym'}, Schedule: ${intake.schedule || 'flexible'}`
    : 'No detailed intake data available.';

  return `You are an expert fitness program architect for Fitness by Maddy, an elite online coaching brand.

Create a detailed Week ${weekNo} program for this client. Return ONLY valid JSON.

CLIENT PROFILE:
Name: ${client.name || 'Client'}
Program: ${client.program} (12-week custom)
Started: ${client.program_started_at}
${intakeSummary}

RECENT CHECK-IN DATA:
${checkinSummary}

OUTPUT FORMAT (strict JSON):
{
  "workout_plan": {
    "overview": "Brief week overview and focus",
    "days": [
      {
        "day": "Day 1 - Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "20 min LISS post-workout"
      }
    ],
    "rest_days": "Wednesday and Sunday"
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meal_timing": [
      { "meal": "Meal 1 - Pre-Workout", "time": "7:00 AM", "description": "..." }
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3-4L water daily"
  },
  "coach_notes": "Personalised note from coach about this week's focus"
}

RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances, SARMs, or steroids
- Keep expectations realistic (0.5-1kg fat loss per week max)
- Adapt based on check-in data: low energy → reduce volume, low compliance → simplify
- If injuries mentioned, provide alternatives for affected body parts
- Include progressive overload from previous weeks`;
}

function generateProgramPdfHtml(client, program, weekNo) {
  const workout = program.workout_plan || program.workout || {};
  const nutrition = program.nutrition_plan || program.nutrition || {};
  const days = workout.days || [];
  const meals = nutrition.meal_timing || [];

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #0a0a0a; color: #fff; padding: 40px; }
  .header { text-align: center; padding: 40px 0; border-bottom: 2px solid #B8965A; margin-bottom: 40px; }
  .brand { font-family: 'Bebas Neue', sans-serif; font-size: 36px; letter-spacing: 6px; color: #B8965A; }
  .week-title { font-family: 'Bebas Neue', sans-serif; font-size: 48px; margin-top: 8px; }
  .client-name { font-size: 14px; color: #888; letter-spacing: 2px; text-transform: uppercase; margin-top: 8px; }
  .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #B8965A; margin: 32px 0 16px; letter-spacing: 3px; }
  .day-block { background: #141414; border: 1px solid #222; border-radius: 4px; padding: 24px; margin-bottom: 16px; }
  .day-name { font-family: 'Bebas Neue', sans-serif; font-size: 20px; color: #B8965A; margin-bottom: 12px; }
  .exercise { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #1a1a1a; font-size: 14px; }
  .exercise:last-child { border-bottom: none; }
  .ex-name { flex: 2; }
  .ex-detail { flex: 1; text-align: center; color: #888; }
  .cardio { font-size: 13px; color: #B8965A; margin-top: 12px; font-style: italic; }
  .nutrition-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .macro-box { background: #141414; border: 1px solid #222; border-radius: 4px; padding: 16px; text-align: center; }
  .macro-value { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; }
  .macro-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
  .meal { background: #141414; border-left: 3px solid #B8965A; padding: 12px 16px; margin-bottom: 8px; }
  .meal-name { font-weight: 600; font-size: 14px; }
  .meal-time { font-size: 12px; color: #888; }
  .meal-desc { font-size: 13px; color: #ccc; margin-top: 4px; }
  .notes { background: #141414; border: 1px solid #B8965A; border-radius: 4px; padding: 24px; margin-top: 32px; font-size: 14px; line-height: 1.7; color: #ccc; }
  .footer { text-align: center; margin-top: 40px; padding-top: 24px; border-top: 1px solid #222; font-size: 12px; color: #555; }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">FITNESS BY MADDY</div>
    <div class="week-title">WEEK ${weekNo} PROGRAM</div>
    <div class="client-name">${client.name || 'Client'}</div>
  </div>

  <div class="section-title">WORKOUT PLAN</div>
  ${workout.overview ? `<p style="color:#888;margin-bottom:16px;font-size:14px;">${workout.overview}</p>` : ''}
  ${days.map(day => `
    <div class="day-block">
      <div class="day-name">${day.day}</div>
      ${(day.exercises || []).map(ex => `
        <div class="exercise">
          <div class="ex-name">${ex.name}</div>
          <div class="ex-detail">${ex.sets} x ${ex.reps}</div>
          <div class="ex-detail">${ex.rest || '-'}</div>
        </div>
      `).join('')}
      ${day.cardio ? `<div class="cardio">${day.cardio}</div>` : ''}
    </div>
  `).join('')}
  ${workout.rest_days ? `<p style="color:#888;font-size:13px;margin-top:8px;">Rest days: ${workout.rest_days}</p>` : ''}

  <div class="section-title">NUTRITION PLAN</div>
  <div class="nutrition-grid">
    <div class="macro-box"><div class="macro-value">${nutrition.calories || '-'}</div><div class="macro-label">Calories</div></div>
    <div class="macro-box"><div class="macro-value">${nutrition.protein_g || '-'}g</div><div class="macro-label">Protein</div></div>
    <div class="macro-box"><div class="macro-value">${nutrition.carbs_g || '-'}g</div><div class="macro-label">Carbs</div></div>
    <div class="macro-box"><div class="macro-value">${nutrition.fat_g || '-'}g</div><div class="macro-label">Fat</div></div>
  </div>
  ${meals.map(m => `
    <div class="meal">
      <div class="meal-name">${m.meal}</div>
      ${m.time ? `<div class="meal-time">${m.time}</div>` : ''}
      ${m.description ? `<div class="meal-desc">${m.description}</div>` : ''}
    </div>
  `).join('')}
  ${nutrition.hydration ? `<p style="color:#888;font-size:13px;margin-top:12px;">Hydration: ${nutrition.hydration}</p>` : ''}

  ${program.coach_notes ? `
    <div class="section-title">COACH NOTES</div>
    <div class="notes">${program.coach_notes}</div>
  ` : ''}

  <div class="footer">
    FITNESS BY MADDY &middot; fitnessbymaddy.com &middot; Generated ${new Date().toLocaleDateString()}
  </div>
</body>
</html>`;
}
