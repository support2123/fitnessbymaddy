const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { notifyMaddy } = require('../lib/escalation');
const { parseBody, corsHeaders } = require('../lib/utils');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'dnp', 'clenbuterol', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in', 'crash diet'
];

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = await parseBody(req);
  const { client_id, week_no } = body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
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

  const prompt = buildPrompt(client, recentCheckins || [], week_no);

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
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const claudeData = await claudeRes.json();
  const generatedText = claudeData.content?.[0]?.text || '';

  const lowerGenerated = generatedText.toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lowerGenerated.includes(flag)) {
      await notifyMaddy('Safety flag in generated program — needs manual review', {
        phone: client.phone,
        clientName: client.name,
        details: `Week ${week_no} — Flag: "${flag}"`
      });
      return res.status(200).json({ action: 'flagged_for_review', flag });
    }
  }

  let workoutPlan, nutritionPlan;
  try {
    const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      workoutPlan = parsed.workout_plan || parsed.workout || null;
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition || null;
    }
  } catch {
    workoutPlan = { raw: generatedText };
    nutritionPlan = null;
  }

  const { data: program, error } = await db.from('programs').insert({
    client_id,
    week_no,
    workout_plan: workoutPlan,
    nutrition_plan: nutritionPlan,
    notes: `Auto-generated for week ${week_no}`,
    pdf_url: null
  }).select().single();

  if (error) {
    return res.status(500).json({ error: 'Failed to save program' });
  }

  const summary = `Week ${week_no} program is ready! Check your email or ask for details.`;
  await sendWhatsApp(client.phone, 'program_ready', [
    client.name || 'there',
    String(week_no),
    summary
  ]);

  await db.from('programs').update({
    whatsapp_sent_at: new Date().toISOString()
  }).eq('id', program.id);

  return res.status(200).json({ success: true, program_id: program.id });
};

function buildPrompt(client, checkins, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, ` +
    `Compliance ${c.compliance_score}/10, Energy ${c.energy}/10` +
    (c.issues ? `, Issues: ${c.issues}` : '')
  ).join('\n');

  return `You are a certified personal trainer and nutrition coach creating a weekly program.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
- Started: ${client.program_started_at}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

RULES:
- Create a progressive, science-based program
- Never prescribe extreme calorie deficits (minimum 1200 cal for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Be realistic with timelines — 0.5-1kg/week fat loss is healthy
- Include warm-up and cool-down in every workout
- Adapt difficulty based on compliance and energy scores

OUTPUT FORMAT (respond with valid JSON only):
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min light cardio + dynamic stretches",
        "cooldown": "5 min static stretching"
      }
    ],
    "rest_days": ["Sunday"],
    "cardio": { "frequency": "3x/week", "type": "LISS or HIIT", "duration": "20-30 min" }
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"] }
    ],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein", "Creatine 5g"]
  }
}`;
}
