const Anthropic = require('@anthropic-ai/sdk');
const { getClient } = require('../lib/supabase');
const { sendText } = require('../lib/whatsapp');

const RISKY_TERMS = [
  'clenbuterol', 'dnp', 'steroid', 'anavar', 'tren',
  'extreme deficit', 'below 800', 'under 800 cal', 'starvation',
  'guaranteed', '30 lbs in', '20 kg in 2 weeks',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getClient();

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

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const systemPrompt = `You are Maddy's program architect — an elite NASM-certified personal trainer and nutrition coach. You design weekly training and nutrition programs for online coaching clients.

Rules:
- Programs must be safe, evidence-based, and progressive
- Never recommend banned substances, extreme calorie deficits (below 1200 cal for women, 1500 for men), or make unrealistic promises
- Consider injuries, age, diet preferences, and schedule constraints
- Warm + expert tone — never bro-sciency
- Output valid JSON only — no markdown, no code fences`;

    const userPrompt = `Design Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Age: ${client.age || 'Unknown'}
- Program: ${client.program}
- Goal: ${client.goal || 'General fitness'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}

${recentCheckins?.length > 0 ? `RECENT CHECK-INS:\n${JSON.stringify(recentCheckins, null, 2)}` : 'No previous check-ins.'}

${prevProgram ? `PREVIOUS WEEK PLAN:\n${JSON.stringify(prevProgram, null, 2)}` : 'No previous program — this is Week 1.'}

Return JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          {"name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "..."}
        ],
        "warmup": "...",
        "cooldown": "..."
      }
    ],
    "weekly_notes": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      {"meal": "Breakfast", "options": ["...", "..."]},
      {"meal": "Lunch", "options": ["...", "..."]},
      {"meal": "Dinner", "options": ["...", "..."]},
      {"meal": "Snacks", "options": ["...", "..."]}
    ],
    "hydration": "...",
    "supplements": ["..."],
    "weekly_notes": "..."
  },
  "coach_note": "Brief motivational note for the client"
}`;

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = response.content[0].text;

    const hasRisk = RISKY_TERMS.some((term) => raw.toLowerCase().includes(term));
    if (hasRisk) {
      const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';
      await sendText(
        MADDY_PHONE,
        `⚠️ Program flagged for review — ${client.name}, Week ${week_no}. Contains potentially risky content. Please review before sending.`
      );

      await db.from('programs').insert({
        client_id,
        week_no,
        notes: 'FLAGGED FOR REVIEW — contains risky terms',
        workout_plan: {},
        nutrition_plan: {},
      });

      return res.status(200).json({ ok: true, flagged: true });
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse program JSON from Claude response');
      }
    }

    const { data: program } = await db
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: parsed.workout_plan,
        nutrition_plan: parsed.nutrition_plan,
        notes: parsed.coach_note || null,
      })
      .select()
      .single();

    const coachNote = parsed.coach_note || `Your Week ${week_no} program is ready!`;
    await sendText(
      client.phone,
      `💪 ${client.name || 'Hey'}, your Week ${week_no} program is here!\n\n${coachNote}\n\nCheck your program details and let us know if you have any questions!`
    );

    if (program) {
      await db
        .from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);
    }

    return res.status(200).json({ ok: true, program_id: program?.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
