const Anthropic = require('anthropic');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .eq('status', 'active')
    .maybeSingle();

  if (!client) return res.status(404).json({ error: 'Active client not found' });

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
    .order('week_no', { ascending: false })
    .limit(1)
    .maybeSingle();

  const anthropic = new Anthropic();

  const systemPrompt = `You are Maddy's AI program architect for FitnessByMaddy.
You create weekly personalised workout and nutrition plans.

Rules:
- Never prescribe banned substances or supplements without medical backing
- Minimum 1200 kcal/day for women, 1500 kcal/day for men
- Never promise specific weight loss timelines
- Include warm-up and cool-down in every workout
- Adjust based on compliance score and energy from check-ins
- Use progressive overload principles
- Be encouraging but honest

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }
      ], "warmup": "...", "cooldown": "..." }
    ],
    "rest_days": ["Sunday"],
    "weekly_notes": "..."
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["..."], "notes": "" }
    ],
    "hydration": "...",
    "supplements": ["..."],
    "weekly_notes": "..."
  },
  "coach_note": "One-liner context for WhatsApp delivery"
}`;

  const userPrompt = `Generate Week ${week_no} program for this client:

Client: ${client.name || 'Anonymous'}
Program: ${client.program}
Started: ${client.program_started_at}

Recent check-ins (newest first):
${JSON.stringify(recentCheckins || [], null, 2)}

Previous week's plan summary:
${prevProgram ? JSON.stringify({ workout: prevProgram.workout_plan, nutrition: prevProgram.nutrition_plan, notes: prevProgram.notes }) : 'No previous plan (first week)'}

Create a progressive, personalised Week ${week_no} plan.`;

  let result;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].text;

    if (hasSafetyIssue(text)) {
      await escalateToMaddy(
        'Program generation safety flag',
        client.phone,
        `Week ${week_no}: AI output contained flagged content`
      );
      return res.status(422).json({ error: 'Safety review required — flagged for Maddy' });
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }
    result = JSON.parse(jsonMatch[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Claude API call failed', detail: err.message });
  }

  const { data: program, error } = await db.from('programs').insert({
    client_id,
    week_no,
    generated_at: new Date().toISOString(),
    workout_plan: result.workout_plan,
    nutrition_plan: result.nutrition_plan,
    notes: result.coach_note || null,
  }).select().single();

  if (error) {
    return res.status(500).json({ error: 'Failed to save program' });
  }

  await sendTemplate(client.phone, 'weekly_program', [
    client.name || 'there',
    String(week_no),
    result.coach_note || `Your Week ${week_no} plan is ready!`,
  ]);

  await db.from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('id', program.id);

  return res.json({ ok: true, program_id: program.id, week_no });
};
