const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/mask');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'under 1000 calories', 'under 800 calories', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'extreme deficit', 'water fast', 'zero carb'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const supabase = getSupabase();

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

    const { data: prevPrograms } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are Maddy's AI program architect for Fitness by Maddy.
Generate a weekly training + nutrition plan for a client.

Rules:
- Science-backed, progressive overload principles
- Never recommend banned substances or extreme calorie deficits (minimum 1200 kcal women, 1500 kcal men)
- Warm, expert tone — never bro-sciency
- Practical for the client's equipment access and schedule
- Adjust based on check-in data: compliance, energy, issues reported

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..." }
      ]}
    ],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 65,
    "meals": [
      { "meal": "Breakfast", "options": ["..."], "macros": "..." }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "One-liner summary of this week's focus and adjustments"
}`;

    const userPrompt = `Client: ${client.name || 'Client'}
Program: ${client.program} (Week ${week_no})
${recentCheckins && recentCheckins.length > 0 ? `\nRecent check-ins:\n${JSON.stringify(recentCheckins, null, 2)}` : '\nNo previous check-ins (first week).'}
${prevPrograms && prevPrograms.length > 0 ? `\nPrevious program notes: ${prevPrograms[0].notes || 'None'}` : ''}

Generate Week ${week_no} program.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0].text;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await escalateToMaddy('Program generation failed', `Client: ${maskPhone(client.phone)}, Week: ${week_no} — no valid JSON returned`);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const program = JSON.parse(jsonMatch[0]);
    const fullText = JSON.stringify(program).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => fullText.includes(flag));

    if (flagged) {
      await escalateToMaddy(
        'Program flagged for safety review',
        `Client: ${maskPhone(client.phone)}, Week: ${week_no} — contains potentially unsafe recommendations`
      );
      return res.status(200).json({ action: 'flagged_for_review', week_no });
    }

    const { data: savedProgram } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: program.workout_plan,
      nutrition_plan: program.nutrition_plan,
      notes: program.notes
    }).select().single();

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      week_no.toString(),
      program.notes || `Week ${week_no} program ready!`
    ]);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', savedProgram.id);

    console.log(`Program generated: ${maskPhone(client.phone)} week=${week_no}`);
    return res.status(200).json({ success: true, program_id: savedProgram.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
