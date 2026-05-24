const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { sendText, detectMarket } = require('./lib/whatsapp');
const { notifyMaddy } = require('./lib/whatsapp');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800', 'extreme deficit',
  'clenbuterol', 'dnp', 'steroids', 'ephedrine',
  'lose 10kg in 1 week', 'crash diet', 'starvation'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lead } = client.lead_id
      ? await db.from('leads').select('intake_data').eq('id', client.lead_id).single()
      : { data: null };

    const anthropic = new Anthropic();

    const systemPrompt = `You are a certified personal trainer and nutrition coach creating a weekly program for a client of "Fitness by Maddy" coaching service.

RULES:
- Programs must be safe, evidence-based, and progressive
- Never prescribe caloric intake below 1200 kcal for women or 1500 kcal for men
- Never recommend supplements beyond basics (protein, creatine, multivitamin)
- Never recommend any banned or dangerous substances
- All exercises must include clear form cues
- Nutrition must be flexible and sustainable, not restrictive
- Include rest days and deload guidance when appropriate

OUTPUT FORMAT: Return valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [{ "name": "", "sets": 0, "reps": "", "rest": "", "notes": "" }] }
    ],
    "rest_days": ["Saturday", "Sunday"],
    "weekly_notes": ""
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_timing": "",
    "sample_meals": [{ "meal": "", "options": [""] }],
    "hydration": "",
    "supplements": []
  },
  "coach_notes": ""
}`;

    const clientContext = buildClientContext(client, checkins, lead?.intake_data);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Generate Week ${week_no} program for this client:\n\n${clientContext}`
      }]
    });

    const programText = response.content[0].text;
    let programData;

    try {
      const jsonMatch = programText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      await notifyMaddy(`Program generation failed to parse for client ${client_id}, week ${week_no}`);
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const outputStr = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => outputStr.includes(flag));

    if (flagged) {
      await notifyMaddy(`SAFETY FLAG: Program for client ${client_id} week ${week_no} contains risky content. Review required before sending.`);
      await db.from('programs').insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: `FLAGGED FOR REVIEW: ${programData.coach_notes || ''}`
      });
      return res.status(200).json({ ok: true, flagged: true, message: 'Program flagged for review' });
    }

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_notes || null
    }).select().single();

    const market = detectMarket(client.phone);
    const msg = market === 'IN'
      ? `Week ${week_no} ka program ready hai! 🔥\n\n${programData.coach_notes || 'Naya week, naya grind. Let\'s go!'}\n\nFull plan aapke dashboard pe available hai.`
      : `Your Week ${week_no} program is ready! 🔥\n\n${programData.coach_notes || 'New week, new grind. Let\'s go!'}\n\nFull plan available on your dashboard.`;

    await sendText(client.phone, msg);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ ok: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildClientContext(client, checkins, intakeData) {
  let context = `Name: ${client.name}\nProgram: ${client.program}\n`;
  context += `Started: ${client.program_started_at}\n`;

  if (intakeData) {
    context += `\nINTAKE DATA:\n`;
    context += `Age: ${intakeData.age || 'N/A'}\n`;
    context += `Gender: ${intakeData.gender || 'N/A'}\n`;
    context += `Goal: ${intakeData.goal || 'N/A'}\n`;
    context += `Height: ${intakeData.height || 'N/A'}\n`;
    context += `Current Weight: ${intakeData.current_weight || 'N/A'}\n`;
    context += `Target Weight: ${intakeData.target_weight || 'N/A'}\n`;
    context += `Injuries: ${intakeData.injuries || 'None'}\n`;
    context += `Medical: ${intakeData.medical_conditions || 'None'}\n`;
    context += `Diet: ${intakeData.diet_preference || 'No preference'}\n`;
    context += `Workout Days: ${intakeData.workout_days || 'N/A'}\n`;
    context += `Equipment: ${intakeData.equipment_access || 'Full gym'}\n`;
  }

  if (checkins && checkins.length > 0) {
    context += `\nRECENT CHECK-INS:\n`;
    checkins.forEach(c => {
      context += `Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm, `;
      context += `Compliance ${c.compliance_score || 'N/A'}/10, Energy ${c.energy || 'N/A'}/10\n`;
      if (c.issues) context += `  Issues: ${c.issues}\n`;
    });
  }

  return context;
}
