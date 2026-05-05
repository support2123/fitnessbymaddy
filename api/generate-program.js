const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./lib/supabase');
const { sendTextMessage } = require('./lib/whatsapp');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'anabolic', 'steroid',
  'lose 10kg in 1 week', 'extreme deficit'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Get last 2 check-ins for context
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Get lead data for intake info
    let intakeData = {};
    if (client.lead_id) {
      const { data: lead } = await supabase
        .from('leads')
        .select('first_msg')
        .eq('id', client.lead_id)
        .single();
      try {
        intakeData = JSON.parse(lead?.first_msg || '{}');
      } catch { intakeData = {}; }
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified personal trainer and nutrition coach creating a weekly training and nutrition program. Output ONLY valid JSON with two keys: "workout_plan" and "nutrition_plan".

workout_plan: object with days as keys (e.g., "day1_push"), each containing:
  - focus: string (muscle group/type)
  - exercises: array of { name, sets, reps, rest_seconds, notes }

nutrition_plan: object with:
  - daily_calories: number
  - protein_g: number
  - carbs_g: number
  - fats_g: number
  - meals: array of { meal_name, foods: string[], calories: number }
  - hydration_liters: number
  - supplements: string[]

Rules:
- Never suggest below 1200 calories for women or 1500 for men
- No banned substances or extreme protocols
- Progressive overload from previous weeks
- Account for any reported injuries or issues
- Be specific with exercise names and rep ranges`;

    const userPrompt = `Client: ${client.name || 'Client'}
Program: ${client.program}
Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}

Intake Data: ${JSON.stringify(intakeData)}

Recent Check-ins: ${JSON.stringify(checkins || [])}

Generate Week ${week_no} program. Consider compliance scores and any issues reported. Progress appropriately from previous data.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const programText = response.content[0].text;

    // Safety check
    const lowerProgram = programText.toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => lowerProgram.includes(flag));
    if (flagged) {
      const { escalateToMaddy } = require('./lib/whatsapp');
      await escalateToMaddy(client.phone, 'Program safety flag', `Week ${week_no} program contained flagged content`);
      return res.status(200).json({ success: false, reason: 'safety_flagged' });
    }

    let plans;
    try {
      plans = JSON.parse(programText);
    } catch {
      const jsonMatch = programText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        plans = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse program JSON');
      }
    }

    // Store in programs table
    const { data: program, error } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: plans.workout_plan,
      nutrition_plan: plans.nutrition_plan,
      notes: `Generated for ${client.name}, week ${week_no}`
    }).select().single();

    if (error) throw error;

    // Send via WhatsApp
    const market = intakeData.market || 'IN';
    const msgText = market === 'IN'
      ? `Week ${week_no} ka program ready hai! 🔥 Check karo aur questions ho toh batao.`
      : `Your Week ${week_no} program is ready! 🔥 Check it out and let me know if you have questions.`;

    await sendTextMessage(client.phone, msgText);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};
