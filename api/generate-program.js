const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./_lib/supabase');
const { sendText, maskPhone } = require('./_lib/whatsapp');
const { escalate } = require('./_lib/escalation');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const SYSTEM_PROMPT = `You are the Program Architect for FitnessByMaddy — an elite online fitness coaching brand.

You generate weekly workout and nutrition plans for clients based on their profile, goals, and recent check-in data.

RULES:
- Plans must be safe, evidence-based, and progressive
- NEVER prescribe extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- NEVER recommend banned/dangerous substances or supplements
- NEVER promise specific weight loss timelines
- Tailor intensity to the client's compliance score and energy levels
- Account for injuries, medical conditions, and equipment access
- Use RPE (Rate of Perceived Exertion) for intensity guidance
- Include warm-up and cool-down in every session
- Nutrition should be practical, culturally appropriate, and flexible

OUTPUT FORMAT (strict JSON):
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..." }
        ],
        "warmup": "...",
        "cooldown": "..."
      }
    ],
    "weekly_volume_notes": "..."
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 140,
    "carbs_g": 200,
    "fats_g": 65,
    "meal_framework": [
      { "meal": "Breakfast", "suggestion": "...", "macros": "..." }
    ],
    "hydration": "...",
    "supplements": "..."
  },
  "coach_note": "A brief motivational + tactical note for the client",
  "safety_flag": false
}

If ANYTHING in the plan could be risky, set "safety_flag": true and explain in "coach_note".`;

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

    let intakeData = null;
    try {
      const { data } = await supabase.storage
        .from('client-data')
        .download(`intakes/${client.lead_id}.json`);
      if (data) {
        intakeData = JSON.parse(await data.text());
      }
    } catch (_) {}

    const clientContext = buildClientContext(client, recentCheckins, intakeData, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: clientContext }]
    });

    const content = response.content[0].text;
    let plan;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      plan = JSON.parse(jsonMatch[0]);
    } catch (_) {
      throw new Error('Failed to parse Claude response as JSON');
    }

    if (plan.safety_flag) {
      await escalate(
        'Safety flag in generated program',
        client.phone,
        `Week ${week_no}: ${plan.coach_note}`
      );
      return res.status(200).json({ ok: true, flagged: true, message: 'Flagged for review' });
    }

    const { data: program, error } = await supabase.from('programs').upsert({
      client_id,
      week_no,
      workout_plan: plan.workout_plan,
      nutrition_plan: plan.nutrition_plan,
      notes: plan.coach_note,
      generated_at: new Date().toISOString()
    }, { onConflict: 'client_id,week_no' }).select().single();

    if (error) throw error;

    const summary = `📋 *Week ${week_no} Program Ready!*\n\n` +
      `${plan.coach_note}\n\n` +
      `🏋️ ${plan.workout_plan.days.length} training days this week\n` +
      `🍽️ Target: ${plan.nutrition_plan.daily_calories} kcal / ${plan.nutrition_plan.protein_g}g protein\n\n` +
      `Full plan is in your client portal. Let's crush it! 💪`;

    const sendResult = await sendText(client.phone, summary);

    if (sendResult.ok) {
      await supabase.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);
    }

    return res.status(200).json({ ok: true, program_id: program.id });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};

function buildClientContext(client, checkins, intake, weekNo) {
  let ctx = `Generate Week ${weekNo} program for this client:\n\n`;
  ctx += `Name: ${client.name || 'Client'}\n`;
  ctx += `Program: ${client.program}\n`;
  ctx += `Started: ${client.program_started_at}\n`;

  if (intake) {
    ctx += `\nINTAKE DATA:\n`;
    ctx += `Age: ${intake.age || 'N/A'}, Gender: ${intake.gender || 'N/A'}\n`;
    ctx += `Height: ${intake.height || 'N/A'}, Starting Weight: ${intake.weight || 'N/A'}\n`;
    ctx += `Goal: ${intake.goal || 'N/A'}\n`;
    ctx += `Injuries: ${intake.injuries || 'None'}\n`;
    ctx += `Medical: ${intake.medical_conditions || 'None'}\n`;
    ctx += `Diet Pref: ${intake.diet_preference || 'N/A'}\n`;
    ctx += `Experience: ${intake.workout_experience || 'N/A'}\n`;
    ctx += `Available Days: ${intake.available_days || 'N/A'}\n`;
    ctx += `Equipment: ${intake.equipment_access || 'N/A'}\n`;
  }

  if (checkins && checkins.length > 0) {
    ctx += `\nRECENT CHECK-INS:\n`;
    for (const c of checkins) {
      ctx += `Week ${c.week_no}: Weight=${c.weight || 'N/A'}, ` +
        `Waist=${c.waist || 'N/A'}, Compliance=${c.compliance_score}/10, ` +
        `Energy=${c.energy}/10, Issues="${c.issues || 'none'}"\n`;
    }
  }

  if (weekNo === 1) {
    ctx += `\nThis is Week 1 — start with a baseline assessment week. Moderate intensity, focus on form and habit building.`;
  } else if (weekNo <= 4) {
    ctx += `\nEarly phase — progressive overload, building consistency.`;
  } else if (weekNo <= 8) {
    ctx += `\nMid phase — intensification. Push volume and intensity if compliance is high.`;
  } else {
    ctx += `\nFinal phase — peak and taper. Maximize results while managing fatigue.`;
  }

  return ctx;
}
