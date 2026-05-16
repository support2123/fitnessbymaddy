const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./_lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM_PROMPT = `You are a certified fitness program architect for FitnessByMaddy.
Generate a detailed, safe, science-backed weekly training and nutrition plan.

RULES:
- Never prescribe fewer than 1200 kcal/day for women or 1500 kcal/day for men
- Never suggest banned substances, fat burners, or extreme protocols
- If the client has medical conditions, be conservative and note "consult physician"
- Include progressive overload logic
- Match exercises to available equipment
- Provide rest day guidance
- Use RPE (Rate of Perceived Exertion) not just sets/reps

OUTPUT FORMAT (JSON):
{
  "workout_plan": {
    "days": [{ "day": "Monday", "focus": "...", "exercises": [...] }],
    "notes": "..."
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meals": [{ "meal": "Breakfast", "options": [...] }],
    "supplements": [],
    "hydration": "..."
  },
  "weekly_focus": "...",
  "adjustments_from_last_week": "..."
}`;

const SAFETY_FLAGS = [
  'extreme', 'very low calorie', 'vlcd', 'dnp', 'clenbuterol',
  'anabolic', 'steroid', 'crash diet', 'water fast'
];

function hasSafetyIssue(plan) {
  const text = JSON.stringify(plan).toLowerCase();
  return SAFETY_FLAGS.some(flag => text.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  const { data: recentCheckins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: intake } = await db
    .from('lead_intake_data')
    .select('*')
    .eq('lead_id', client.lead_id)
    .single();

  const userPrompt = `Generate Week ${week_no} program for:
Name: ${client.name || 'Client'}
Program: ${client.program}
${intake ? `
Age: ${intake.age}
Gender: ${intake.gender}
Goal: ${intake.goal}
Equipment: ${intake.equipment}
Training days/week: ${intake.training_days}
Diet preference: ${intake.diet_preference}
Injuries: ${intake.injuries || 'None'}
Current weight: ${intake.current_weight}kg
Target weight: ${intake.target_weight}kg
Medical: ${intake.medical_conditions || 'None'}
` : ''}
${recentCheckins && recentCheckins.length > 0 ? `
Recent check-ins:
${recentCheckins.map(c => `Week ${c.week_no}: weight=${c.weight}kg, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`).join('\n')}
` : 'No previous check-ins (first week).'}

Generate the program JSON.`;

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  let programData;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0].text;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    programData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('Claude API error:', e.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }

  if (hasSafetyIssue(programData)) {
    await notifyMaddy(
      'SAFETY FLAG: Program review needed',
      `Client ${client.name} Week ${week_no} — AI generated potentially unsafe content`
    );
    return res.status(200).json({ flagged: true, message: 'Sent to Maddy for review' });
  }

  const { error } = await db.from('programs').insert({
    client_id,
    week_no,
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: programData.weekly_focus || null,
    pdf_url: null
  });

  if (error) {
    console.error('Program save error:', error.message);
    return res.status(500).json({ error: 'Failed to save program' });
  }

  await sendWhatsApp(client.phone, 'weekly_program', {
    name: client.name || 'Champion',
    templateParams: [String(week_no), programData.weekly_focus || 'Consistency is key!']
  });

  await db.from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('client_id', client_id)
    .eq('week_no', week_no);

  return res.status(200).json({ success: true, week_no });
};
