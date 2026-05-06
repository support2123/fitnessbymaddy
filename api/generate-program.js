const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800',
  'steroid', 'sarm', 'clenbuterol', 'dnp', 'ephedrine',
  'lose 10kg in 1 week', 'crash diet'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();

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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy.
You create personalized weekly workout and nutrition plans based on client data.

Rules:
- Plans must be safe, science-based, and realistic
- Never prescribe extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Consider injuries and limitations
- Progressive overload principles
- Adjust based on compliance and energy scores from check-ins

Output JSON with two keys: "workout_plan" and "nutrition_plan".
workout_plan: array of 5-6 training days with exercises, sets, reps, rest.
nutrition_plan: object with daily_calories, protein_g, carbs_g, fats_g, meal_timing, sample_meals.
Also include a "notes" field with a 1-2 sentence personalized note for the client.`;

    const userPrompt = `Generate Week ${week_no} program for this client:

Client: ${client.name || 'Client'}
Program: ${client.program}
Started: ${client.program_started_at}

Recent check-ins:
${JSON.stringify(recentCheckins || [], null, 2)}

Create a progressive, personalized plan for week ${week_no}. Return valid JSON only.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;
    const lower = content.toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => lower.includes(flag));

    if (flagged) {
      const { escalateToMaddy } = require('./lib/escalation');
      await escalateToMaddy('Safety flag in generated program', {
        phone: client.phone,
        message: `Week ${week_no} program flagged for review`,
      });
      return res.status(200).json({ flagged: true, message: 'Program flagged for Maddy review' });
    }

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const { error } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: parsed.workout_plan || null,
      nutrition_plan: parsed.nutrition_plan || null,
      notes: parsed.notes || null,
      pdf_url: null,
    });

    if (error) {
      console.error('Program insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    await sendWhatsApp(client.phone, 'weekly_program_ready', [
      client.name || 'there',
      `Week ${week_no}`,
      parsed.notes || 'Your new program is ready!',
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no));

    return res.status(200).json({ success: true, week_no });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
