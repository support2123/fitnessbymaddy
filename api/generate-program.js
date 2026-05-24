const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'starvation',
  'steroid', 'sarm', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'crash diet'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

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

  const anthropic = new Anthropic();

  const systemPrompt = `You are a certified fitness program architect working for FitnessByMaddy.
You design weekly workout and nutrition plans for clients based on their profile and progress.

Rules:
- Never recommend fewer than 1200 calories for women or 1500 for men
- Never recommend any banned substances or supplements without medical backing
- Never promise unrealistic timelines (max 1kg/week fat loss)
- Programs must be progressive and sustainable
- Always include rest days (minimum 1-2 per week)
- Adjust based on compliance score and energy levels from check-ins

Output format: JSON with "workout_plan" and "nutrition_plan" keys.
workout_plan should have day-by-day structure with exercises, sets, reps.
nutrition_plan should have daily macros and a sample meal framework.
Include a "notes" field with a 1-2 sentence personalized note for the client.`;

  const userPrompt = `Generate Week ${week_no} program for this client:

Profile: ${JSON.stringify(client.intake_data || {})}
Program type: ${client.program}
Recent check-ins: ${JSON.stringify(recentCheckins || [])}

Return valid JSON only with keys: workout_plan, nutrition_plan, notes`;

  let response;
  try {
    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });
  } catch (err) {
    return res.status(500).json({ error: 'Claude API failed' });
  }

  const content = response.content[0]?.text || '';

  for (const flag of SAFETY_FLAGS) {
    if (content.toLowerCase().includes(flag)) {
      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: null,
        nutrition_plan: null,
        notes: `FLAGGED FOR REVIEW: Contains "${flag}"`
      });
      return res.status(200).json({ flagged: true, reason: flag });
    }
  }

  let parsed;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch[0]);
  } catch (_) {
    return res.status(500).json({ error: 'Failed to parse program JSON' });
  }

  const { error } = await db.from('programs').insert({
    client_id,
    week_no,
    workout_plan: parsed.workout_plan,
    nutrition_plan: parsed.nutrition_plan,
    notes: parsed.notes || null,
    pdf_url: null
  });

  if (error) return res.status(500).json({ error: 'Failed to save program' });

  const contextNote = parsed.notes || `Week ${week_no} program is ready!`;
  await sendWhatsApp(client.phone, 'weekly_program', {
    name: client.name || 'there',
    templateParams: [client.name || 'there', String(week_no), contextNote]
  });

  return res.status(200).json({ success: true, week_no });
};
