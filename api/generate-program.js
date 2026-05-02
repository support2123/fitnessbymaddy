const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

const UNSAFE_PATTERNS = [
  /under\s*800\s*cal/i,
  /under\s*1000\s*cal/i,
  /steroids?/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedra/i,
  /lose\s*\d+\s*kg.*in\s*(1|2|3)\s*day/i
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  const { data: profile } = await supabase
    .from('client_profiles')
    .select('*')
    .eq('lead_id', client.lead_id)
    .single();

  const { data: recentCheckins } = await supabase
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const anthropic = new Anthropic();

  const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy.
You create weekly workout and nutrition plans that are safe, science-backed, and personalized.

RULES:
- Never recommend calories below 1200 for women or 1500 for men
- Never suggest banned substances or extreme protocols
- Always include rest days (minimum 1-2 per week)
- Adapt based on compliance scores and reported issues
- If client reports pain/injury, reduce intensity and flag for review
- Output MUST be valid JSON with keys: workout_plan, nutrition_plan, notes`;

  const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
${JSON.stringify(profile || {}, null, 2)}

PROGRAM: ${client.program}
STARTED: ${client.program_started_at}

RECENT CHECK-INS (newest first):
${JSON.stringify(recentCheckins || [], null, 2)}

Return a JSON object with:
- workout_plan: array of daily workouts (exercise, sets, reps, rest)
- nutrition_plan: object with calories, protein, carbs, fats, meal_suggestions
- notes: string with key focus areas for this week`;

  let response;
  try {
    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });
  } catch (e) {
    return res.status(500).json({ error: 'Claude API call failed' });
  }

  const content = response.content[0].text;

  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(content)) {
      const { sendWhatsApp: sw } = require('./lib/whatsapp');
      await sw('+917082478374', 'escalation_alert', [
        'Unsafe program content detected',
        client.phone,
        `Week ${week_no} generation flagged for review`
      ]);
      return res.status(200).json({ flagged: true, reason: 'unsafe_content' });
    }
  }

  let parsed;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to parse program JSON' });
  }

  const { error } = await supabase.from('programs').insert({
    client_id,
    week_no: parseInt(week_no),
    generated_at: new Date().toISOString(),
    workout_plan: parsed.workout_plan,
    nutrition_plan: parsed.nutrition_plan,
    notes: parsed.notes || ''
  });

  if (error) {
    return res.status(500).json({ error: 'Failed to save program' });
  }

  await sendWhatsApp(client.phone, 'weekly_program', [
    client.name || 'there',
    `Week ${week_no}`,
    parsed.notes || 'New week, new focus!'
  ]);

  return res.status(200).json({ success: true, week_no });
};
