const { supabase } = require('../lib/supabase');
const { sendText } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'under 1000 calories',
  'under 800 calories',
  'extreme deficit',
  'clenbuterol',
  'dnp',
  'ephedra',
  'anabolic',
  'steroid',
  'sarm',
  'crash diet',
  'water fast',
  'lose 10kg in 1 week',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
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

    const { data: lead } = client.lead_id
      ? await supabase.from('leads').select('first_msg').eq('id', client.lead_id).single()
      : { data: null };

    let intakeData = {};
    try {
      if (lead?.first_msg) intakeData = JSON.parse(lead.first_msg);
    } catch (_) {}

    const prompt = buildPrompt(client, intakeData, recentCheckins || [], week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    const rawOutput = claudeData.content?.[0]?.text || '';

    const lowerOutput = rawOutput.toLowerCase();
    const flagged = SAFETY_FLAGS.some((f) => lowerOutput.includes(f));

    if (flagged) {
      await escalateToMaddy(
        'Safety flag in generated program',
        `Client ${maskPhone(client.phone)} W${week_no} — flagged content detected`
      );
      return res.status(200).json({
        success: false,
        reason: 'safety_flagged',
        message: 'Program flagged for Maddy review',
      });
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const parsed = JSON.parse(rawOutput);
      workoutPlan = parsed.workout_plan || parsed.workout;
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition;
      notes = parsed.notes || parsed.coach_notes || '';
    } catch (_) {
      workoutPlan = { raw: rawOutput };
      nutritionPlan = {};
      notes = '';
    }

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: workoutPlan,
        nutrition_plan: nutritionPlan,
        notes,
        pdf_url: null,
      })
      .select()
      .single();

    const contextNote = notes
      ? `Week ${week_no} program ready! ${notes.substring(0, 100)}`
      : `Week ${week_no} program ready! Check your plan and reach out if you have any questions 💪`;

    await sendText(client.phone, contextNote);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const checkinSummary = checkins
    .map(
      (c) =>
        `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
    )
    .join('\n');

  return `You are an expert fitness coach AI assistant for FitnessByMaddy. Generate a personalized weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of 12
- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Goal: ${intake.goal || 'general fitness'}
- Injuries: ${intake.injuries || 'none reported'}
- Diet preference: ${intake.diet_preference || 'no restriction'}
- Schedule: ${intake.schedule || 'flexible'}
- Experience: ${intake.experience || 'intermediate'}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins yet (Week 1)'}

RULES:
- Never prescribe fewer than 1400 calories for women or 1600 for men
- Never recommend any banned substances or supplements requiring medical supervision
- Keep protein between 1.6-2.2g per kg bodyweight
- Include warm-up and cool-down in every workout
- Be progressive — increase volume or intensity gradually
- Address any reported issues from check-ins
- Tone: warm, expert, encouraging — never bro-science

Return ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..." }
      ], "warmup": "...", "cooldown": "..." }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 65,
    "meal_timing": "...",
    "sample_meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "hydration": "..."
  },
  "notes": "One-liner coach note for the client"
}`;
}
