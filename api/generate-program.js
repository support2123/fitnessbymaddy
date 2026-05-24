const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { programLabel } = require('../lib/utils');

const MADDY_PHONE = '917082478374';

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'sarms', 'steroids',
  'lose 10kg in 1 week', 'lose 20 pounds in'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
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

    const { data: intakeData } = await db
      .from('lead_intake')
      .select('*')
      .eq('lead_id', client.lead_id)
      .single();

    const prompt = buildPrompt(client, recentCheckins || [], intakeData, week_no);

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

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error('Claude API error:', errText);
      return res.status(502).json({ error: 'Claude API failed' });
    }

    const claudeData = await claudeRes.json();
    const rawOutput = claudeData.content[0].text;

    const lowerOutput = rawOutput.toLowerCase();
    const isSafe = !SAFETY_FLAGS.some(flag => lowerOutput.includes(flag));

    if (!isSafe) {
      await sendTemplate(MADDY_PHONE, 'escalation_alert', [
        client.name || maskPhone(client.phone),
        'Program flagged for safety review',
        `Week ${week_no} — auto-generation halted`
      ]);
      return res.status(200).json({ ok: false, reason: 'safety_flagged' });
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const parsed = JSON.parse(rawOutput);
      workoutPlan = parsed.workout_plan || parsed.workout;
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition;
      notes = parsed.notes || parsed.coach_notes || '';
    } catch {
      workoutPlan = { raw: rawOutput };
      nutritionPlan = {};
      notes = 'Raw output — manual formatting needed';
    }

    const { data: program, error } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes
    }).select().single();

    if (error) {
      console.error('Program insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      programLabel(client.program),
      notes ? notes.slice(0, 200) : 'Your new program is ready!'
    ]);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ ok: true, program_id: program.id });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, intake, weekNo) {
  const clientInfo = [
    `Client: ${client.name || 'Unknown'}`,
    `Program: ${programLabel(client.program)}`,
    `Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}`,
    intake ? `Age: ${intake.age}, Gender: ${intake.gender}` : '',
    intake ? `Goal: ${intake.goal}` : '',
    intake ? `Injuries/conditions: ${intake.injuries || 'None'}, ${intake.medical_conditions || 'None'}` : '',
    intake ? `Diet preference: ${intake.diet_preference || 'No preference'}` : '',
    intake ? `Equipment: ${intake.equipment_access || 'Full gym'}` : '',
    intake ? `Available days: ${intake.available_days || '5'}` : ''
  ].filter(Boolean).join('\n');

  const checkinSummary = checkins.length > 0
    ? checkins.map(c =>
      `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
    ).join('\n')
    : 'No previous check-ins yet (Week 1).';

  return `You are a NASM-certified fitness coach creating a weekly program for an online coaching client.

CLIENT PROFILE:
${clientInfo}

RECENT CHECK-INS:
${checkinSummary}

INSTRUCTIONS:
- Create a complete workout plan for this week (${intake?.available_days || 5} training days)
- Create a nutrition plan with macros and meal examples
- Adjust based on check-in data: if compliance is low, simplify; if energy is low, reduce volume
- If client reported issues, adapt accordingly
- Use progressive overload from previous weeks
- Be specific: exercises, sets, reps, rest periods, RPE
- Nutrition: daily calories, protein/carb/fat targets, 4 meal examples

SAFETY RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances or supplements requiring medical supervision
- Never promise specific weight loss timelines
- Flag any concern that needs human coach review

Respond in valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Day 1 - Upper Push", "exercises": [...] }
    ],
    "notes": "..."
  },
  "nutrition_plan": {
    "daily_calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fat_g": 0,
    "meals": [...]
  },
  "notes": "One-liner coach note for the client"
}`;
}
