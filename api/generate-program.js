const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendTextMessage } = require('../lib/whatsapp');
const { needsEscalation, notifyMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client || client.status !== 'active') {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    let intakeData = null;
    if (client.lead_id) {
      const { data } = await db.storage
        .from('intake-forms')
        .download(`${client.lead_id}.json`);
      if (data) {
        intakeData = JSON.parse(await data.text());
      }
    }

    const prompt = buildPrompt(client, recentCheckins || [], intakeData, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
    if (!jsonMatch) {
      await notifyMaddy('Program generation failed', `Could not parse output for ${maskPhone(client.phone)} week ${week_no}`);
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const programData = JSON.parse(jsonMatch[1]);

    if (hasSafetyIssues(programData)) {
      await notifyMaddy(
        'Program flagged for review',
        `${client.name || maskPhone(client.phone)} week ${week_no} — potential safety issue detected`
      );
      return res.status(200).json({ action: 'flagged_for_review', week_no });
    }

    const { data: program, error } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_note || null
    }).select().single();

    if (error) throw error;

    const note = programData.coach_note || `Week ${week_no} program ready!`;
    await sendTextMessage(
      client.phone,
      `📋 Week ${week_no} Plan Ready!\n\n${note}\n\nCheck your program details in the app. Questions? Just reply here!`
    );

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, intake, weekNo) {
  const profile = [
    `Client: ${client.name || 'Unknown'}`,
    `Program: ${client.program}`,
    `Week: ${weekNo} of 12`,
    intake ? `Age: ${intake.age}, Gender: ${intake.gender}` : '',
    intake ? `Goal: ${intake.goal}` : '',
    intake ? `Injuries/Conditions: ${intake.injuries || 'None'}` : '',
    intake ? `Diet preference: ${intake.diet_preference || 'No preference'}` : '',
    intake ? `Workout days/week: ${intake.workout_days || 'Not specified'}` : '',
    intake ? `Equipment: ${intake.equipment || 'Full gym'}` : '',
    intake ? `Current weight: ${intake.current_weight}kg, Target: ${intake.target_weight}kg` : '',
    intake ? `Height: ${intake.height}cm` : ''
  ].filter(Boolean).join('\n');

  const checkinSummary = checkins.length > 0
    ? checkins.map(c =>
      `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`
    ).join('\n')
    : 'No previous check-ins.';

  return `You are "Program Architect" for FitnessByMaddy, an elite online coaching brand.
Generate a weekly training and nutrition plan for this client.

CLIENT PROFILE:
${profile}

RECENT CHECK-INS:
${checkinSummary}

RULES:
- Science-backed, progressive overload principles
- Never prescribe extreme calorie cuts (minimum 1200 kcal women, 1500 kcal men)
- Never recommend banned/dangerous supplements
- If client reports pain or injury, modify exercises around it
- Adjust volume/intensity based on compliance and energy scores
- Indian-friendly food options if market is IN

OUTPUT FORMAT — respond ONLY with a JSON block:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." },
    "deload_notes": ""
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_timing": "...",
    "sample_meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "coach_note": "A 1-2 sentence motivational note for the client about this week's focus."
}
\`\`\``;
}

function hasSafetyIssues(program) {
  const np = program.nutrition_plan;
  if (np && np.calories && np.calories < 1000) return true;

  const banned = ['dnp', 'clenbuterol', 'ephedra', 'anabolic', 'steroid', 'sarm', 'hgh'];
  const supps = (np?.supplements || []).join(' ').toLowerCase();
  if (banned.some(b => supps.includes(b))) return true;

  return false;
}
