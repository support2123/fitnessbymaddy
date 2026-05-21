const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./_lib/supabase');
const { sendMessage } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/mask-phone');
const { escalateToMaddy } = require('./_lib/escalation');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800', 'very low calorie',
  'clenbuterol', 'dnp', 'steroids', 'sarms', 'ephedra',
  'lose 10kg in 1 week', 'extreme cut', 'water fast',
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

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
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();
    const { data: client } = await db.from('clients').select('*').eq('id', client_id).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db.from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await db.from('programs')
      .select('workout_plan,nutrition_plan,week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const prompt = `You are a certified personal trainer and nutrition coach creating Week ${week_no} of a 12-week customised fitness program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}

RECENT CHECK-INS:
${JSON.stringify(recentCheckins || [], null, 2)}

PREVIOUS WEEK PLAN:
${JSON.stringify(prevPrograms?.[0] || 'First week', null, 2)}

Generate a complete weekly plan in JSON format:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }] },
      ...
    ],
    "rest_days": ["Sunday"],
    "cardio": { "type": "...", "duration": "...", "frequency": "..." }
  },
  "nutrition_plan": {
    "calories": ...,
    "protein_g": ...,
    "carbs_g": ...,
    "fats_g": ...,
    "meals": [
      { "meal": "Breakfast", "options": ["...", "..."] },
      ...
    ],
    "hydration": "...",
    "supplements": ["..."]
  },
  "notes": "Brief coaching note for the week"
}

RULES:
- Be evidence-based. No bro-science.
- Never recommend below 1200 calories for women or 1500 for men.
- Never recommend banned substances.
- Adjust based on check-in data (compliance, energy, weight trends).
- Keep the tone warm and encouraging.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text;

    if (hasSafetyIssue(text)) {
      await escalateToMaddy(
        'Safety flag in generated program',
        `Client: ${maskPhone(client.phone)}, Week ${week_no}\nFlagged content detected — held for review.`
      );
      return res.status(200).json({ held: true, reason: 'safety_review' });
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        workoutPlan = parsed.workout_plan;
        nutritionPlan = parsed.nutrition_plan;
        notes = parsed.notes;
      }
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr.message);
      notes = text;
    }

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: workoutPlan || null,
      nutrition_plan: nutritionPlan || null,
      notes: notes || null,
    }).select().single();

    await sendMessage(
      client.phone,
      null,
      'weekly_program',
      true
    );

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    console.log(`Program generated: ${maskPhone(client.phone)} Week ${week_no}`);
    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};
