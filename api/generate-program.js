const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');

const SAFETY_FLAGS = [
  'less than 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'anabolic', 'steroid',
  'lose 10 kg in a week', 'lose 20 pounds in',
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();

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

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .eq('week_no', week_no - 1)
      .single();

    const anthropic = new Anthropic();

    const systemPrompt = `You are Maddy's AI program architect for FitnessByMaddy. You create personalised weekly workout and nutrition plans.

Rules:
- Be evidence-based (NASM guidelines)
- Never recommend extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Progressive overload each week
- Account for client feedback and compliance
- Output valid JSON only

Output format:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..." }
      ]},
      ...
    ],
    "cardio": "...",
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fats_g": 60,
    "meal_timing": ["..."],
    "hydration": "...",
    "supplements": ["..."]
  },
  "coach_note": "One sentence motivation/context for the week"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

Client: ${client.name || 'Client'}
Program: ${client.program}
Started: ${client.program_started_at}

${recentCheckins?.length ? `Recent check-ins:
${recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n')}` : 'No check-ins yet (Week 1).'}

${prevProgram ? `Previous week plan summary: ${prevProgram.notes || 'Standard progression'}` : 'No previous program (first week).'}

Generate the next week's plan with appropriate progression.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = response.content[0].text;

    if (hasSafetyIssue(responseText)) {
      await escalateToMaddy(
        'Safety flag in generated program',
        client.phone,
        `Week ${week_no} program flagged for review`
      );
      return res.status(200).json({
        success: false,
        reason: 'flagged_for_review',
        message: 'Program flagged for Maddy review before sending',
      });
    }

    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Program generation parse error' });
    }

    const { data: program, error } = await db.from('programs').upsert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.coach_note || null,
    }, { onConflict: 'client_id,week_no' }).select().single();

    if (error) {
      console.error('Program save error:', error.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      parsed.coach_note || 'Your new weekly plan is ready!',
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
