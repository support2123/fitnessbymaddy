const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { cors, parseBody, getProgramName } = require('./lib/helpers');
const { escalateToMaddy } = require('./lib/escalate');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'anabolic steroids', 'sarms',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'water fast for weight loss'
];

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const body = await parseBody(req);
    const { client_id, week_no } = body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
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

    const { data: lastProgram } = await db
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const { data: intakeMsg } = await db
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .ilike('body', '%Intake form submitted%')
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect working for FitnessByMaddy.
You create weekly workout and nutrition plans that are:
- Science-backed and progressive
- Personalised to the client's data and check-in feedback
- Safe and sustainable (no extreme calorie cuts, no banned substances)
- Clear and actionable

Output valid JSON only with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }
      ]},
      ...
    ],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 250,
    "fat_g": 70,
    "meal_framework": [
      { "meal": "Breakfast", "suggestion": "...", "macros": "..." },
      ...
    ],
    "hydration": "...",
    "supplements": ["..."]
  },
  "weekly_note": "Short motivational + tactical note for the client"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

Client: ${client.name || 'Client'}
Program: ${getProgramName(client.program)}
Started: ${client.program_started_at}

${intakeMsg ? `Intake data: ${intakeMsg.body}` : 'No intake data available.'}

Recent check-ins:
${recentCheckins?.length ? recentCheckins.map(c =>
  `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`
).join('\n') : 'No check-ins yet (Week 1).'}

${lastProgram ? `Last week's plan summary: Calories ${lastProgram.nutrition_plan?.calories || 'N/A'}, Focus areas from notes: ${lastProgram.notes || 'N/A'}` : 'First week — build a solid foundation program.'}

Generate the next week's program. Adjust based on compliance, energy, and any issues reported. Return JSON only.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await escalateToMaddy(client.phone, 'Program generation failed — no valid JSON returned', rawText.slice(0, 500));
      return res.status(500).json({ error: 'Invalid program output' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const outputStr = JSON.stringify(programData).toLowerCase();
    for (const flag of SAFETY_FLAGS) {
      if (outputStr.includes(flag)) {
        await escalateToMaddy(
          client.phone,
          `Safety flag in generated program: "${flag}"`,
          `Week ${week_no} program for ${client.name}`
        );
        return res.status(200).json({
          action: 'flagged_for_review',
          flag,
          client_id
        });
      }
    }

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.weekly_note
    }).select().single();

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      programData.weekly_note || 'Your new plan is ready!'
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({
      action: 'program_generated',
      program_id: program.id,
      week_no
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
