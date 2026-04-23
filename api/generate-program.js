const { supabase } = require('./lib/supabase');
const { sendTemplate, notifyMaddy, maskPhone } = require('./lib/whatsapp');
const { corsHeaders, json, parseBody } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    const body = await parseBody(req);
    const { client_id, week_no } = body;

    if (!client_id || !week_no) {
      return json(res, 400, { error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*, leads(*)')
      .eq('id', client_id)
      .single();

    if (!client) return json(res, 404, { error: 'Client not found' });

    const { data: intake } = await supabase
      .from('intake_submissions')
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

    const prompt = buildProgramPrompt(client, intake, recentCheckins, week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error('Claude API error:', errText);
      return json(res, 502, { error: 'Program generation failed' });
    }

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content[0]?.text || '';

    let workoutPlan, nutritionPlan, notes;
    try {
      const parsed = JSON.parse(responseText);
      workoutPlan = parsed.workout_plan;
      nutritionPlan = parsed.nutrition_plan;
      notes = parsed.notes;
    } catch {
      workoutPlan = { raw: responseText };
      nutritionPlan = {};
      notes = 'Raw response — manual review needed';
    }

    if (containsRiskyContent(responseText)) {
      await notifyMaddy(
        'Program flagged for review',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek ${week_no}\nReason: Potentially risky content detected in generated program. Please review before sending.`
      );

      await supabase.from('programs').insert({
        client_id, week_no,
        workout_plan: workoutPlan,
        nutrition_plan: nutritionPlan,
        notes: 'FLAGGED FOR REVIEW: ' + (notes || '')
      });

      return json(res, 200, { success: true, flagged: true });
    }

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id, week_no,
        workout_plan: workoutPlan,
        nutrition_plan: nutritionPlan,
        notes
      })
      .select()
      .single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      notes || 'New week, new gains! Check your program.'
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return json(res, 200, { success: true, program_id: program.id });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return json(res, 500, { error: 'Internal server error' });
  }
};

function buildProgramPrompt(client, intake, checkins, weekNo) {
  const clientProfile = {
    name: client.name,
    program: client.program,
    week: weekNo,
    age: intake?.age,
    gender: intake?.gender,
    height: intake?.height_cm,
    weight: intake?.weight_kg,
    goal: intake?.goal,
    injuries: intake?.injuries,
    medical: intake?.medical_conditions,
    diet: intake?.diet_preference,
    meals_per_day: intake?.meals_per_day,
    workout_days: intake?.workout_days_per_week,
    equipment: intake?.equipment_access
  };

  const checkinSummary = (checkins || []).map(c => ({
    week: c.week_no,
    weight: c.weight,
    waist: c.waist,
    compliance: c.compliance_score,
    energy: c.energy,
    issues: c.issues
  }));

  return `You are a certified personal trainer and nutrition coach creating a weekly fitness program.

CLIENT PROFILE:
${JSON.stringify(clientProfile, null, 2)}

RECENT CHECK-INS:
${JSON.stringify(checkinSummary, null, 2)}

Create a detailed Week ${weekNo} program. Return ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          {"name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": ""}
        ],
        "cardio": "20min LISS post-workout"
      }
    ],
    "weekly_volume_notes": ""
  },
  "nutrition_plan": {
    "daily_calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meal_timing": [
      {"meal": "Breakfast", "time": "8am", "example": "4 eggs + 2 toast + avocado"}
    ],
    "supplements": [],
    "hydration": "3-4L water daily"
  },
  "notes": "Brief coach note for the client about this week's focus"
}

RULES:
- Be safe and evidence-based. No extreme calorie cuts below 1200 cal.
- No banned substances or dangerous supplement recommendations.
- Adapt to any injuries or medical conditions mentioned.
- If this is Week 1, start conservative and build.
- Progressive overload from previous weeks based on check-in data.
- Keep it practical and motivating.`;
}

function containsRiskyContent(text) {
  const lower = text.toLowerCase();
  const flags = [
    'below 1000 cal', 'under 1000 cal', '800 calorie', '900 calorie',
    'clenbuterol', 'dnp', 'dinitrophenol', 'ephedra', 'steroid',
    'testosterone injection', 'hgh injection',
    'lose 10kg in 1 week', 'lose 20 pounds in',
    'extreme fasting', 'water fast for'
  ];
  return flags.some(f => lower.includes(f));
}
