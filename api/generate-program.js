const { getSupabase } = require('./_lib/supabase');
const { sendText, notifyMaddy } = require('./_lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000 cal', 'under 800 cal',
  'starvation', 'clenbuterol', 'dnp', 'ephedra', 'steroid',
  'anabolic', 'sarm', 'hgh', 'testosterone injection',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

function checkSafety(plan) {
  const text = JSON.stringify(plan).toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (text.includes(flag)) return { safe: false, flag };
  }
  return { safe: true, flag: null };
}

async function callClaude(systemPrompt, userPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Claude API error: ${data.error?.message || res.status}`);
  return data.content[0].text;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const sb = getSupabase();

    const { data: client } = await sb.from('clients').select('*').eq('id', client_id).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await sb
      .from('intake_forms')
      .select('*')
      .eq('client_id', client_id)
      .limit(1)
      .single();

    const { data: recentCheckins } = await sb
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevProgram } = await sb
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const systemPrompt = `You are the Program Architect for Fitness by Maddy, an elite online coaching brand.
You create weekly personalized workout and nutrition plans.

RULES:
- Evidence-based programming only. No bro-science.
- Progressive overload principles for training.
- Sustainable calorie targets (never below 1200 kcal for women, 1500 kcal for men).
- Account for injuries, medical conditions, and equipment access.
- Include warm-up and cool-down in every session.
- Nutrition: macros + meal timing + hydration + supplement suggestions (only proven ones like creatine, protein, vitamin D).
- If the client has PCOS: prioritize insulin sensitivity, anti-inflammatory nutrition, stress management.
- If 40+: prioritize joint health, recovery, bone density exercises.

OUTPUT FORMAT: Return valid JSON with exactly this structure:
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
    "weekly_cardio": "3x 20-min LISS or 2x 15-min HIIT"
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fat_g": 73,
    "meals": [
      { "meal": "Breakfast", "time": "8:00 AM", "options": ["Option 1", "Option 2"] }
    ],
    "hydration": "3-4L water daily",
    "supplements": ["5g creatine monohydrate", "Whey protein post-workout"]
  },
  "coach_note": "Brief motivational note for the client"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
${intake ? `- Age: ${intake.age}, Gender: ${intake.gender}
- Height: ${intake.height_cm}cm, Current weight: ${intake.current_weight}kg
- Goal weight: ${intake.goal_weight}kg, Goal: ${intake.goal}
- Injuries: ${intake.injuries || 'None'}
- Medical conditions: ${intake.medical_conditions || 'None'}
- Diet preference: ${intake.diet_preference || 'No preference'}
- Meals/day: ${intake.meals_per_day || 3}
- Workout days/week: ${intake.workout_days_per_week || 5}
- Equipment: ${intake.equipment_access || 'Full gym'}
- Wake: ${intake.wake_time || '7:00 AM'}, Sleep: ${intake.sleep_time || '11:00 PM'}` : '- No intake form data available'}

RECENT CHECK-INS:
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')
  : 'No previous check-ins (this is week 1)'}

${prevProgram ? `PREVIOUS WEEK PLAN SUMMARY:
${prevProgram.notes || 'See previous workout/nutrition plan for progression reference'}` : ''}

Generate the complete Week ${week_no} plan. Ensure progressive overload from previous weeks if applicable. Return ONLY valid JSON.`;

    const claudeResponse = await callClaude(systemPrompt, userPrompt);

    let parsed;
    try {
      const jsonMatch = claudeResponse.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : claudeResponse);
    } catch (parseErr) {
      console.error('Failed to parse Claude response');
      await notifyMaddy(
        `⚠️ PROGRAM GENERATION FAILED\nClient: ${client.name || client.phone}\nWeek: ${week_no}\nReason: Invalid AI response format`
      );
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const safety = checkSafety(parsed);
    if (!safety.safe) {
      await notifyMaddy(
        `🚨 PROGRAM SAFETY FLAG\nClient: ${client.name || client.phone}\nWeek: ${week_no}\nFlag: "${safety.flag}"\nProgram held for manual review.`
      );
      await sb.from('programs').insert({
        client_id, week_no: parseInt(week_no),
        workout_plan: parsed.workout_plan,
        nutrition_plan: parsed.nutrition_plan,
        notes: `SAFETY FLAGGED: ${safety.flag}. Awaiting Maddy review.`
      });
      return res.status(200).json({ ok: true, status: 'flagged_for_review', flag: safety.flag });
    }

    const programText = formatProgramForWhatsApp(parsed, week_no, client.name);

    const { data: program } = await sb.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.coach_note || null
    }).select().single();

    await sendText(client.phone, programText);

    await sb.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ ok: true, program_id: program.id });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function formatProgramForWhatsApp(plan, weekNo, name) {
  let msg = `💪 *Week ${weekNo} Program — ${name || 'Your Plan'}*\n\n`;

  if (plan.coach_note) {
    msg += `📝 _${plan.coach_note}_\n\n`;
  }

  if (plan.workout_plan?.days) {
    msg += `🏋️ *WORKOUT PLAN*\n`;
    for (const day of plan.workout_plan.days) {
      msg += `\n*${day.day} — ${day.focus}*\n`;
      if (day.warmup) msg += `🔄 Warmup: ${day.warmup}\n`;
      for (const ex of (day.exercises || [])) {
        msg += `• ${ex.name}: ${ex.sets}×${ex.reps} (${ex.rest} rest)\n`;
      }
      if (day.cooldown) msg += `🧘 Cooldown: ${day.cooldown}\n`;
    }
    if (plan.workout_plan.rest_days) {
      msg += `\n🛏️ Rest days: ${plan.workout_plan.rest_days.join(', ')}\n`;
    }
    if (plan.workout_plan.weekly_cardio) {
      msg += `🏃 Cardio: ${plan.workout_plan.weekly_cardio}\n`;
    }
  }

  if (plan.nutrition_plan) {
    const n = plan.nutrition_plan;
    msg += `\n🥗 *NUTRITION PLAN*\n`;
    msg += `Calories: ${n.calories} kcal\n`;
    msg += `Protein: ${n.protein_g}g | Carbs: ${n.carbs_g}g | Fat: ${n.fat_g}g\n`;
    if (n.meals) {
      msg += `\n`;
      for (const meal of n.meals) {
        msg += `*${meal.meal}* (${meal.time})\n`;
        for (const opt of (meal.options || [])) {
          msg += `  • ${opt}\n`;
        }
      }
    }
    if (n.hydration) msg += `\n💧 ${n.hydration}\n`;
    if (n.supplements) msg += `💊 ${n.supplements.join(', ')}\n`;
  }

  msg += `\n---\nQuestions? Reply here anytime! 🙌`;
  return msg;
}
