const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'under 800',
  'banned substance', 'steroid', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'crash diet', 'starvation',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body || {};
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'missing client_id or week_no' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .maybeSingle();

    if (!client) return res.status(404).json({ error: 'client not found' });

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
      .limit(1);

    let intake = {};
    if (intakeData && intakeData[0]) {
      try { intake = JSON.parse(intakeData[0].body); } catch (_) {}
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy.
Generate a weekly training and nutrition plan in JSON format.
Be evidence-based, safe, and progressive. Never recommend extreme calorie deficits (below 1200 for women, 1500 for men), banned substances, or unrealistic timelines.
Output must be valid JSON with two keys: "workout_plan" and "nutrition_plan".
workout_plan: array of 7 day objects, each with "day", "focus", "exercises" (array of {name, sets, reps, rest, notes}).
nutrition_plan: object with "daily_calories", "protein_g", "carbs_g", "fat_g", "meals" (array of {meal, time, foods, notes}).
Include a "coach_note" string with a brief motivational/context note for the client.`;

    const userPrompt = `Client profile:
- Program: ${client.program}
- Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}
- Name: ${client.name || 'Client'}
- Intake data: ${JSON.stringify(intake)}

Recent check-ins (most recent first):
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map(c => `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`).join('\n')
  : 'No previous check-ins (first week)'}

Generate the Week ${week_no} program. Adjust based on check-in trends. If compliance is low, simplify. If energy is low, reduce volume. Progress if metrics are improving.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch (_) {
      await escalateToMaddy('program_parse_error', maskPhone(client.phone), `Week ${week_no} generation failed to parse`);
      return res.status(500).json({ error: 'failed to parse program' });
    }

    const combined = JSON.stringify(parsed).toLowerCase();
    const flagged = SAFETY_FLAGS.some(f => combined.includes(f));

    if (flagged) {
      await escalateToMaddy('unsafe_program', maskPhone(client.phone), `Week ${week_no} flagged for safety review`);
      return res.json({ ok: false, reason: 'flagged_for_review', week_no });
    }

    const { error } = await db.from('programs').upsert({
      client_id,
      week_no: parseInt(week_no, 10),
      generated_at: new Date().toISOString(),
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.coach_note || null,
    }, {
      onConflict: 'client_id,week_no',
    });

    if (error) {
      console.error('program upsert error:', error.message);
      return res.status(500).json({ error: 'db_error' });
    }

    const coachNote = parsed.coach_note || `Week ${week_no} program is ready!`;
    await sendTemplate(
      client.phone,
      'weekly_program',
      [client.name || 'there', String(week_no), coachNote],
      client.name || 'there'
    );

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.json({ ok: true, week_no, client_id });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
