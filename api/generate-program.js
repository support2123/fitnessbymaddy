const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'starvation',
  'clenbuterol', 'dnp', 'steroids', 'anabolic',
  'lose 10kg in 1 week', 'crash diet', 'extreme fast'
];

function checkSafetyFlags(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.filter(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lead } = client.lead_id
      ? await supabase.from('leads').select('*').eq('id', client.lead_id).single()
      : { data: null };

    const clientContext = {
      name: client.name,
      program: client.program,
      week: week_no,
      recentCheckins: recentCheckins || [],
      programInterest: lead?.program_interest,
      market: lead?.market || 'GLOBAL'
    };

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand.
Generate a weekly training and nutrition plan for the client.

RULES:
- Programs must be safe, evidence-based, and appropriate for the client's level
- Never recommend extreme calorie deficits (minimum 1200 cal/day for women, 1500 for men)
- Never recommend banned or dangerous substances
- Never promise unrealistic timelines
- Base progression on the client's recent check-in data
- Be specific: exact exercises, sets, reps, rest periods
- Include warm-up and cool-down
- Nutrition: provide macro targets, meal timing, hydration

Output STRICTLY as JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name":"...","sets":3,"reps":"8-12","rest":"60s","notes":"..."}], "warmup": "...", "cooldown": "..." }
    ],
    "weekly_volume": "...",
    "progression_note": "..."
  },
  "nutrition_plan": {
    "daily_calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fat_g": 0,
    "meals": [{"meal":"Breakfast","description":"...","macros":"..."}],
    "hydration": "...",
    "supplements": ["..."]
  },
  "coach_note": "..."
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Generate Week ${week_no} program for this client:\n${JSON.stringify(clientContext, null, 2)}`
      }]
    });

    const rawText = response.content[0].text;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const programData = JSON.parse(jsonMatch[0]);
    const fullText = JSON.stringify(programData);
    const flags = checkSafetyFlags(fullText);

    if (flags.length > 0) {
      await supabase.from('escalations').insert({
        phone: client.phone,
        reason: `Safety flags in generated program: ${flags.join(', ')}`,
        message_body: `Week ${week_no} program for ${client.name} flagged`
      });
      return res.status(200).json({
        ok: false,
        reason: 'safety_flagged',
        flags
      });
    }

    const { data: program, error } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.coach_note || null
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const coachNote = programData.coach_note || `Week ${week_no} program ready!`;
    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `${week_no}`,
      coachNote.slice(0, 120)
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ ok: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
