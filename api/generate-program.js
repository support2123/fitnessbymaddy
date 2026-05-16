const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate, maskPhone } = require('./lib/whatsapp');

const SAFETY_FLAGS = [
  'under 1000 calories', 'under 800 calories', 'extreme cut',
  'clenbuterol', 'dnp', 'steroid', 'anavar', 'sarm',
  'lose 10kg in 1 week', 'water fast', 'zero carb'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supabase = getSupabase();
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*, lead:lead_id(*)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: existingProgram } = await supabase
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existingProgram) {
      return res.status(200).json({ success: true, already_exists: true });
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const intake = client.intake_data || {};
    const checkinSummary = (recentCheckins || []).map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues
    }));

    const prompt = `You are Maddy's program architect for FitnessByMaddy. Generate Week ${week_no} of a 12-week custom training program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${intake.age || 'Unknown'}
- Gender: ${intake.gender || 'Unknown'}
- Goal: ${intake.goal || 'General fitness'}
- Injuries/Limitations: ${intake.injuries || 'None reported'}
- Diet Preference: ${intake.diet_pref || 'No preference'}
- Schedule: ${intake.schedule || 'Flexible'}
- Experience: ${intake.experience_level || 'Intermediate'}

RECENT CHECK-INS:
${JSON.stringify(checkinSummary, null, 2)}

RULES:
- Minimum 1400 calories for women, 1600 for men
- Never recommend banned substances or extreme protocols
- Progressively overload from previous weeks
- Include warm-up and cool-down in every session
- 4-5 training days, 2-3 rest/active recovery
- Practical meals with Indian/global options based on preference

OUTPUT FORMAT (JSON only, no markdown):
{
  "workout_plan": {
    "overview": "Brief week focus",
    "days": [
      {
        "day": "Day 1 - Upper Body Push",
        "exercises": [
          {"name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": ""}
        ],
        "warmup": "5 min cardio + dynamic stretches",
        "cooldown": "5 min stretch"
      }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 1800,
    "protein_g": 140,
    "carbs_g": 200,
    "fat_g": 60,
    "meals": [
      {"meal": "Breakfast", "options": ["Option 1", "Option 2"]},
      {"meal": "Lunch", "options": ["Option 1", "Option 2"]},
      {"meal": "Dinner", "options": ["Option 1", "Option 2"]},
      {"meal": "Snacks", "options": ["Option 1", "Option 2"]}
    ],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein", "Creatine 5g"]
  },
  "notes": "Coaching note for the week"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = response.content[0].text;

    if (hasSafetyIssue(responseText)) {
      const { createEscalation } = require('./lib/escalation');
      await createEscalation(
        client.phone,
        'Program safety flag - needs Maddy review',
        `Week ${week_no} program for ${maskPhone(client.phone)} flagged for safety review`,
        client_id
      );
      return res.status(200).json({ success: false, reason: 'safety_flagged' });
    }

    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch (e) {
      console.error('Failed to parse program JSON:', e.message);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const { data: program } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes
    }).select().single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'Champion',
      String(week_no),
      programData.notes || `Week ${week_no} is ready!`
    ]);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
