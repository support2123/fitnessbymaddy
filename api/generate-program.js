const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./lib/supabase');
const { sendTemplate, maskPhone } = require('./lib/whatsapp');
const { notifyMaddy } = require('./lib/escalate');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'sarm', 'steroid', 'anavar',
  'lose 10 kg in 1 week', 'lose 20 pounds in 2 weeks',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { clientId, weekNo } = req.body;

    if (!clientId || !weekNo) {
      return res.status(400).json({ error: 'clientId and weekNo required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', clientId)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await supabase
      .from('programs')
      .select('*')
      .eq('client_id', clientId)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are the Program Architect for FitnessByMaddy, an elite online fitness coaching brand.
Your job: generate a week-by-week workout plan and nutrition plan for a client based on their profile, recent check-ins, and progress.

RULES:
- Never prescribe banned substances, SARMs, steroids, or any supplement that requires a prescription.
- Never set calories below 1200 for women or 1500 for men.
- Never promise unrealistic results (e.g., "lose 10kg in 1 week").
- Factor in injuries, medical conditions, and stated limitations.
- Use progressive overload principles.
- Be warm, motivating, and expert in tone. No bro-science.

OUTPUT FORMAT: Return valid JSON only with this structure:
{
  "weekNo": <number>,
  "workoutPlan": {
    "split": "<e.g. Push/Pull/Legs>",
    "days": [
      {
        "day": "<Day name>",
        "focus": "<e.g. Push / Upper / Rest>",
        "exercises": [
          { "name": "<exercise>", "sets": <n>, "reps": "<rep range>", "rest": "<rest period>", "notes": "<optional>" }
        ]
      }
    ]
  },
  "nutritionPlan": {
    "calories": <number>,
    "protein": <number in grams>,
    "carbs": <number in grams>,
    "fats": <number in grams>,
    "meals": [
      { "meal": "<Meal name>", "time": "<approx time>", "foods": ["<food item with portion>"] }
    ],
    "supplements": ["<if any safe ones>"]
  },
  "coachNotes": "<1-2 sentence motivational + tactical note for the client>"
}`;

    const userPrompt = buildClientPrompt(client, recentCheckins, lastProgram, weekNo);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = response.content[0].text;

    let jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Claude did not return valid JSON');
    }

    const plan = JSON.parse(jsonMatch[0]);

    const flagged = checkSafetyFlags(raw);
    if (flagged) {
      await notifyMaddy('Program flagged for safety review', {
        name: client.name,
        phone: client.phone,
        details: `Week ${weekNo}: ${flagged}`,
      });
      await supabase.from('programs').insert({
        client_id: clientId,
        week_no: weekNo,
        workout_plan: plan.workoutPlan,
        nutrition_plan: plan.nutritionPlan,
        notes: `FLAGGED: ${flagged}. Awaiting Maddy review.`,
      });
      return res.status(200).json({ ok: true, flagged: true, reason: flagged });
    }

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id: clientId,
        week_no: weekNo,
        workout_plan: plan.workoutPlan,
        nutrition_plan: plan.nutritionPlan,
        notes: plan.coachNotes,
      })
      .select()
      .single();

    await sendTemplate(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        `Week ${weekNo}`,
        plan.coachNotes || 'Your new program is ready!',
      ],
    });

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ ok: true, programId: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

function buildClientPrompt(client, checkins, lastProgram, weekNo) {
  const intake = client.intake_data || {};
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${client.program}\n`;
  prompt += `Age: ${intake.age || 'Unknown'}\n`;
  prompt += `Gender: ${intake.gender || 'Unknown'}\n`;
  prompt += `Height: ${intake.height || 'Unknown'}\n`;
  prompt += `Starting weight: ${intake.weight || 'Unknown'}\n`;
  prompt += `Goal: ${intake.goal || 'General fitness'}\n`;
  prompt += `Injuries: ${intake.injuries || 'None reported'}\n`;
  prompt += `Diet preference: ${intake.dietPreference || 'No preference'}\n`;
  prompt += `Schedule: ${intake.schedule || 'Flexible'}\n`;
  prompt += `Experience: ${intake.experience || 'Intermediate'}\n`;
  prompt += `Medical: ${intake.medicalConditions || 'None'}\n`;

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent check-ins:\n`;
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      prompt += '\n';
    }
  }

  if (lastProgram) {
    prompt += `\nLast week's split: ${lastProgram.workout_plan?.split || 'N/A'}\n`;
    prompt += `Last week's calories: ${lastProgram.nutrition_plan?.calories || 'N/A'}\n`;
  }

  return prompt;
}

function checkSafetyFlags(text) {
  const lower = text.toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) {
      return `Contains: "${flag}"`;
    }
  }
  return null;
}
