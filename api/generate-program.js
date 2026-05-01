const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { jsonResponse } = require('../lib/helpers');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'anabolic', 'steroid',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return jsonResponse(res, {}, 200);
  if (req.method !== 'POST') return jsonResponse(res, { error: 'Method not allowed' }, 405);

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return jsonResponse(res, { error: 'Unauthorized' }, 401);
  }

  const db = getSupabase();
  const { client_id, week_no } = req.body || {};

  if (!client_id || !week_no) {
    return jsonResponse(res, { error: 'client_id and week_no required' }, 400);
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return jsonResponse(res, { error: 'Client not found' }, 404);

  const { data: recentCheckins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const checkinSummary = (recentCheckins || []).map(c => ({
    week: c.week_no,
    weight: c.weight,
    waist: c.waist,
    compliance: c.compliance_score,
    energy: c.energy,
    issues: c.issues,
  }));

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const systemPrompt = `You are "Program Architect" for FitnessByMaddy, a NASM-certified online fitness coach.
Generate a detailed, science-based weekly workout and nutrition plan.

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Push", "exercises": [
        { "name": "...", "sets": 4, "reps": "8-12", "rest": "90s", "notes": "" }
      ]}
    ],
    "rest_days": ["Sunday"],
    "cardio": { "type": "...", "duration": "...", "frequency": "..." }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "weekly_note": "One-liner context for the client"
}

Rules:
- Never prescribe below 1200 kcal for women or 1500 kcal for men
- Never recommend banned substances
- Adjust based on check-in data (compliance, energy, weight trend)
- If client reports pain/injury, scale back that movement pattern
- Keep meal options realistic and culturally relevant to client's market`;

  const userPrompt = `Client: ${client.name || 'Client'}
Program: ${client.program}
Week: ${week_no} of 12
Phone market: ${client.phone?.startsWith('91') ? 'India' : 'International'}

Recent check-ins: ${JSON.stringify(checkinSummary)}

Generate Week ${week_no} plan.`;

  let aiResponse;
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    aiResponse = msg.content[0].text;
  } catch (err) {
    console.error('Claude API error:', err.message);
    return jsonResponse(res, { error: 'AI generation failed' }, 500);
  }

  const lowerResponse = aiResponse.toLowerCase();
  const hasSafetyFlag = SAFETY_FLAGS.some(flag => lowerResponse.includes(flag));
  if (hasSafetyFlag) {
    await notifyMaddy(
      'Program flagged for safety review',
      `Client: ${client.name}\nWeek: ${week_no}\nFlagged content detected - review before sending.`
    );
    return jsonResponse(res, { error: 'Flagged for manual review', flagged: true }, 200);
  }

  let parsed;
  try {
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : aiResponse);
  } catch (err) {
    console.error('JSON parse error:', err.message);
    return jsonResponse(res, { error: 'Failed to parse AI response' }, 500);
  }

  const { data: program, error } = await db.from('programs').insert({
    client_id,
    week_no: parseInt(week_no),
    workout_plan: parsed.workout_plan,
    nutrition_plan: parsed.nutrition_plan,
    notes: parsed.weekly_note,
  }).select().single();

  if (error) {
    console.error('Program insert error:', error.message);
    return jsonResponse(res, { error: 'Failed to store program' }, 500);
  }

  const contextNote = parsed.weekly_note || `Week ${week_no} plan is ready!`;
  await sendTemplate(client.phone, 'weekly_program', [
    client.name || 'there',
    String(week_no),
    contextNote,
  ]);

  await db.from('programs').update({
    whatsapp_sent_at: new Date().toISOString(),
  }).eq('id', program.id);

  return jsonResponse(res, { ok: true, program_id: program.id });
};
