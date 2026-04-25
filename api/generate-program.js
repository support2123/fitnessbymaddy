const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, sendEscalation } = require('./lib/whatsapp');
const { handleCors, jsonError, jsonOk } = require('./lib/helpers');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(f => lower.includes(f));
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return jsonError(res, 'POST only', 405);

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return jsonError(res, 'Unauthorized', 401);
  }

  const db = getSupabase();
  const { client_id, week_no } = req.body || {};

  if (!client_id || !week_no) return jsonError(res, 'client_id and week_no required');

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return jsonError(res, 'Client not found', 404);

  const { data: recentCheckins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: intakeData } = await db
    .from('messages')
    .select('body')
    .eq('phone', client.phone)
    .eq('template_name', 'intake_form')
    .order('sent_at', { ascending: false })
    .limit(1)
    .single();

  let profile = {};
  try { profile = JSON.parse(intakeData?.body || '{}'); } catch (_) {}

  const prompt = buildPrompt(client, profile, recentCheckins || [], week_no);

  const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
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

  const claudeData = await claudeResp.json();
  const responseText = claudeData.content?.[0]?.text || '';

  if (hasSafetyIssue(responseText)) {
    await sendEscalation(
      'Program safety flag',
      `Client ${client.name || client_id}, Week ${week_no}: AI output flagged for unsafe content`
    );
    return jsonError(res, 'Program flagged for safety review', 422);
  }

  let workoutPlan, nutritionPlan, notes;
  try {
    const parsed = JSON.parse(responseText);
    workoutPlan = parsed.workout_plan || parsed.workout;
    nutritionPlan = parsed.nutrition_plan || parsed.nutrition;
    notes = parsed.notes || parsed.coach_notes || '';
  } catch (_) {
    workoutPlan = { raw: responseText };
    nutritionPlan = {};
    notes = '';
  }

  const { data: program } = await db.from('programs').insert({
    client_id,
    week_no,
    generated_at: new Date().toISOString(),
    workout_plan: workoutPlan,
    nutrition_plan: nutritionPlan,
    notes,
  }).select('id').single();

  await sendWhatsApp(client.phone, 'weekly_program', [
    client.name || 'there',
    `Week ${week_no}`,
    notes || 'Your new weekly plan is ready!',
  ]);

  if (program) {
    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);
  }

  return jsonOk(res, { generated: true, program_id: program?.id });
};

function buildPrompt(client, profile, checkins, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a certified fitness coach creating a weekly program for a client.
Return ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "...", "sets": 3, "reps": "10-12", "rest": "60s", "notes": "" }
      ]}
    ],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fat_g": 0,
    "meal_plan": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "Brief coach note for the client (1-2 sentences)"
}

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
- Goal: ${profile.goal || 'general fitness'}
- Age: ${profile.age || 'unknown'}
- Gender: ${profile.gender || 'unknown'}
- Experience: ${profile.experience_level || 'intermediate'}
- Injuries/Conditions: ${profile.injuries || 'none reported'}
- Diet preference: ${profile.diet_pref || 'no restrictions'}
- Schedule: ${profile.schedule || 'flexible'}
- Current weight: ${lastCheckin?.weight || profile.current_weight || 'unknown'}
- Target weight: ${profile.target_weight || 'not specified'}

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'}
- Waist: ${lastCheckin.waist || 'N/A'}
- Compliance: ${lastCheckin.compliance_score}/10
- Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'none'}` : 'No previous check-in data available.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'}
- Compliance: ${prevCheckin.compliance_score}/10
- Energy: ${prevCheckin.energy}/10` : ''}

RULES:
- Never suggest calories below 1200 for women or 1500 for men
- No banned substances or supplements requiring prescription
- Adjust intensity based on compliance and energy scores
- If injuries noted, provide modifications
- Keep it progressive from previous week
- Be realistic with timelines`;
}
