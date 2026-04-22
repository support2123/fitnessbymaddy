const { supabase } = require('./lib/supabase');
const { sendTemplate, maskPhone } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');

const RISKY_CONTENT = [
  'below 1200 calories', 'below 1000 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'anavar', 'steroid',
  'lose 10kg in 1 week', 'lose 20 pounds in'
];

function hasDangerousContent(text) {
  const lower = (text || '').toLowerCase();
  return RISKY_CONTENT.some(term => lower.includes(term));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*, leads!clients_lead_id_fkey(*)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const intakeData = client.leads?.intake_data || {};

    const systemPrompt = `You are a certified fitness coach and nutrition specialist working for FitnessByMaddy.
You create personalized weekly workout and nutrition plans based on client data.

RULES:
- Never prescribe fewer than 1400 calories for women or 1600 for men
- Never recommend banned substances or steroids
- Never promise unrealistic timelines (e.g., "lose 10kg in 1 week")
- Always include warm-up and cool-down in workout plans
- Consider injuries and medical conditions carefully
- Output valid JSON only

OUTPUT FORMAT:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [ { "name": "...", "sets": 3, "reps": "10-12", "rest": "60s", "notes": "" } ] },
      ...
    ],
    "warmup": "5-10 min dynamic stretching",
    "cooldown": "5-10 min static stretching + foam rolling"
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] },
      ...
    ],
    "supplements": ["..."],
    "hydration": "3-4 liters water daily"
  },
  "notes": "Focus areas and adjustments for this week"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Unknown'}
- Program: ${client.program}
- Goal: ${intakeData.goal || 'general fitness'}
- Age: ${intakeData.age || 'unknown'}
- Gender: ${intakeData.gender || 'unknown'}
- Current weight: ${intakeData.current_weight || 'unknown'}
- Target weight: ${intakeData.target_weight || 'unknown'}
- Height: ${intakeData.height || 'unknown'}
- Experience: ${intakeData.experience_level || 'intermediate'}
- Injuries: ${intakeData.injuries || 'none reported'}
- Medical conditions: ${intakeData.medical_conditions || 'none reported'}
- Diet preference: ${intakeData.diet_preference || 'no preference'}
- Workout schedule: ${intakeData.workout_schedule || '5 days/week'}

RECENT CHECK-IN DATA:
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map(c => `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues=${c.issues || 'none'}`).join('\n')
  : 'No previous check-ins (this is Week 1)'}

Generate a complete, personalized Week ${week_no} plan. Return ONLY valid JSON.`;

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = message.content[0].text;

    if (hasDangerousContent(responseText)) {
      await escalateToMaddy(
        'Risky program content flagged',
        `Client: ${maskPhone(client.phone)} | Week ${week_no} — auto-generation halted`
      );
      return res.status(200).json({ flagged: true, reason: 'Content flagged for review' });
    }

    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const { data: program } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      workout_plan: parsed.workout_plan || null,
      nutrition_plan: parsed.nutrition_plan || null,
      notes: parsed.notes || null,
      generated_at: new Date().toISOString()
    }).select().single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      parsed.notes || 'Your new program is ready!'
    ]);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({
      success: true,
      program_id: program.id,
      week_no
    });
  } catch (err) {
    console.error('Generate error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};
