const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendText } = require('./lib/whatsapp');
const { PROGRAM_NAMES, cors } = require('./lib/helpers');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

module.exports = async function handler(req, res) {
  cors(res);
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

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .eq('week_no', week_no - 1)
      .single();

    const prompt = buildPrompt(client, recentCheckins || [], prevProgram, week_no);

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
    const content = claudeData.content?.[0]?.text || '';

    const isFlagged = SAFETY_FLAGS.some(flag => content.toLowerCase().includes(flag));

    if (isFlagged) {
      await db.from('programs').upsert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        workout_plan: null,
        nutrition_plan: null,
        notes: `FLAGGED FOR REVIEW: ${content.slice(0, 500)}`,
        flagged: true,
      }, { onConflict: 'client_id,week_no' });

      await db.from('escalations').insert({
        phone: client.phone,
        client_id: client.id,
        reason: 'program_safety_flag',
        message_body: `Week ${week_no} program flagged: contains potentially unsafe content`,
      });

      const MADDY_PHONE = '+917082478374';
      await sendText(MADDY_PHONE,
        `PROGRAM FLAGGED: Client ${client.name || client.phone.slice(-4)}, Week ${week_no}. Review needed before sending.`
      );

      return res.status(200).json({ ok: true, flagged: true });
    }

    let workout_plan, nutrition_plan;
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        workout_plan = parsed.workout_plan || parsed.workout || null;
        nutrition_plan = parsed.nutrition_plan || parsed.nutrition || null;
      } else {
        const parsed = JSON.parse(content);
        workout_plan = parsed.workout_plan || parsed.workout || null;
        nutrition_plan = parsed.nutrition_plan || parsed.nutrition || null;
      }
    } catch {
      workout_plan = { raw: content };
      nutrition_plan = null;
    }

    const { error: progError } = await db.from('programs').upsert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      workout_plan,
      nutrition_plan,
      notes: `Auto-generated for week ${week_no}`,
      flagged: false,
    }, { onConflict: 'client_id,week_no' });

    if (progError) throw progError;

    const programName = PROGRAM_NAMES[client.program] || client.program;
    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      programName,
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ ok: true, week_no });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

function buildPrompt(client, checkins, prevProgram, weekNo) {
  const profile = [
    `Client: ${client.name || 'Unknown'}`,
    client.age ? `Age: ${client.age}` : null,
    client.goal ? `Goal: ${client.goal}` : null,
    client.injuries ? `Injuries/Limitations: ${client.injuries}` : null,
    client.diet_pref ? `Diet Preference: ${client.diet_pref}` : null,
    client.schedule ? `Schedule: ${client.schedule}` : null,
    `Program: ${client.program}`,
    `Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}`,
  ].filter(Boolean).join('\n');

  const checkinData = checkins.length > 0
    ? checkins.map(c => [
      `Week ${c.week_no}:`,
      c.weight ? `  Weight: ${c.weight}kg` : null,
      c.waist ? `  Waist: ${c.waist}cm` : null,
      c.compliance_score ? `  Compliance: ${c.compliance_score}/10` : null,
      c.energy ? `  Energy: ${c.energy}/10` : null,
      c.issues ? `  Issues: ${c.issues}` : null,
    ].filter(Boolean).join('\n')).join('\n\n')
    : 'No previous check-in data available.';

  const prevProgramData = prevProgram
    ? `Previous week plan:\n${JSON.stringify(prevProgram, null, 2)}`
    : 'No previous program data (first week).';

  return `You are a certified fitness coach assistant for Fitness by Maddy. Generate a personalized weekly training and nutrition plan.

CLIENT PROFILE:
${profile}

RECENT CHECK-IN DATA:
${checkinData}

${prevProgramData}

INSTRUCTIONS:
- Create a progressive, safe, evidence-based plan for this specific week
- Include 5-6 training days with specific exercises, sets, reps, rest periods
- Include a nutrition plan with daily calorie targets, macro splits, and sample meals
- Adjust based on check-in data: increase/decrease volume, modify nutrition as needed
- If compliance is low, simplify the plan
- If energy is low, reduce volume and check nutrition
- NEVER recommend below 1200 calories for women or 1500 for men
- NEVER recommend any banned substances or supplements
- NEVER promise unrealistic timelines
- Keep tone warm, professional, motivating

Respond with ONLY a JSON object in this exact format:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          {"name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": ""}
        ],
        "cardio": "15 min incline walk"
      }
    ],
    "notes": "Weekly training notes"
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      {"meal": "Breakfast", "suggestion": "3 eggs + 2 toast + fruit", "calories": 450}
    ],
    "hydration": "3L water daily",
    "notes": "Weekly nutrition notes"
  }
}
\`\`\``;
}
