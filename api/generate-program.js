const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

  const { data: checkins } = await supabase
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: lead } = client.lead_id
    ? await supabase.from('leads').select('intake_data').eq('id', client.lead_id).single()
    : { data: null };

  const prompt = buildPrompt(client, checkins || [], lead?.intake_data, week_no);

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const responseText = message.content[0].text;
  let programData;
  try {
    const jsonMatch = responseText.match(/```json\n?([\s\S]*?)```/) ||
                      responseText.match(/\{[\s\S]*\}/);
    programData = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : responseText);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to parse program output' });
  }

  if (hasSafetyIssues(programData)) {
    const { escalateToMaddy } = require('./lib/escalate');
    await escalateToMaddy(
      'Program safety flag',
      `Client: ${client.name} | Week ${week_no} — needs manual review`
    );
    return res.status(200).json({ action: 'flagged_for_review' });
  }

  const { data: program } = await supabase.from('programs').insert({
    client_id,
    week_no,
    generated_at: new Date().toISOString(),
    workout_plan: programData.workout_plan || programData.workouts,
    nutrition_plan: programData.nutrition_plan || programData.nutrition,
    notes: programData.notes || ''
  }).select().single();

  await sendWhatsApp(client.phone, 'weekly_program', {
    name: client.name,
    templateParams: [
      client.name,
      `Week ${week_no}`,
      programData.notes || 'Your new week is ready!'
    ]
  });

  await supabase
    .from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('id', program.id);

  return res.status(200).json({ success: true, program_id: program.id });
};

function buildPrompt(client, checkins, intakeData, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a certified personal trainer and nutrition coach creating a weekly program.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Week: ${weekNo} of 12
- Started: ${client.program_started_at}
${intakeData ? `- Age: ${intakeData.age}, Gender: ${intakeData.gender}
- Height: ${intakeData.height}, Starting weight: ${intakeData.weight}
- Goal: ${intakeData.goal}
- Injuries/limitations: ${intakeData.injuries || 'None'}
- Diet preference: ${intakeData.diet_pref || 'Flexible'}
- Schedule: ${intakeData.schedule || 'Not specified'}
- Experience: ${intakeData.experience_level || 'Intermediate'}` : ''}

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight}kg, Waist: ${lastCheckin.waist}cm
- Compliance: ${lastCheckin.compliance_score}/10, Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'None'}` : ''}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight}kg, Waist: ${prevCheckin.waist}cm
- Compliance: ${prevCheckin.compliance_score}/10, Energy: ${prevCheckin.energy}/10` : ''}

RULES:
- Safe, progressive overload approach
- No extreme calorie deficits (never below BMR - 300)
- No banned/dangerous supplements
- Account for stated injuries
- Be specific with sets, reps, rest periods
- Include warm-up and cool-down

Return ONLY a JSON object with this structure:
\`\`\`json
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": ""}] },
      ...
    ],
    "rest_days": ["Sunday"],
    "cardio": "..."
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_timing": "...",
    "sample_meals": ["...", "..."],
    "hydration": "...",
    "supplements": ["..."]
  },
  "notes": "One-line motivational context for the week"
}
\`\`\``;
}

function hasSafetyIssues(data) {
  if (!data) return true;
  const nutrition = data.nutrition_plan || data.nutrition || {};
  if (nutrition.calories && nutrition.calories < 1000) return true;
  const supplements = nutrition.supplements || [];
  const banned = ['dnp', 'clenbuterol', 'ephedra', 'sarm', 'steroid'];
  for (const s of supplements) {
    if (banned.some(b => s.toLowerCase().includes(b))) return true;
  }
  return false;
}
