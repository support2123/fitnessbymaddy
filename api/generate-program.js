const { supabase } = require('./lib/supabase');
const { sendText, notifyMaddy } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { data: recentCheckins } = await supabase
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const anthropic = new Anthropic();
  const prompt = buildPrompt(client, recentCheckins, week_no);

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const responseText = message.content[0].text;

  if (hasSafetyIssue(responseText)) {
    await notifyMaddy(
      'Program flagged for safety review',
      `Client: ${client.name || client.phone}\nWeek: ${week_no}\nReason: Safety keyword detected in generated program`
    );
    return res.status(200).json({ ok: false, reason: 'safety_flagged' });
  }

  let programData;
  try {
    const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/);
    programData = JSON.parse(jsonMatch ? jsonMatch[1] : responseText);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to parse program JSON' });
  }

  const { data: program, error } = await supabase.from('programs').insert({
    client_id,
    week_no,
    workout_plan: programData.workout_plan || programData.workout,
    nutrition_plan: programData.nutrition_plan || programData.nutrition,
    notes: programData.notes || null,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  const summaryMsg = client.goal
    ? `Week ${week_no} program ready! Focus: ${programData.notes || client.goal}. Full plan sent to your folder.`
    : `Week ${week_no} program is ready! Check your folder for the full plan.`;

  await sendText(client.phone, summaryMsg);

  await supabase.from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('id', program.id);

  return res.status(200).json({ ok: true, program_id: program.id });
};

function buildPrompt(client, checkins, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
  ).join('\n');

  return `You are a certified fitness program architect. Generate a weekly training and nutrition plan.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Goal: ${client.goal || 'body recomposition'}
- Age: ${client.age || 'unknown'}
- Injuries/limitations: ${client.injuries || 'none reported'}
- Diet preference: ${client.diet_pref || 'flexible'}
- Schedule: ${client.schedule || '5 days/week'}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins'}

GENERATE Week ${weekNo} program.

Rules:
- Progressive overload from previous weeks
- Adjust calories based on compliance and weight trend
- Never go below 1200 calories for women or 1500 for men
- No banned substances or extreme protocols
- Include rest days
- Be specific: sets, reps, tempo, rest periods

Return ONLY valid JSON in this format:
\`\`\`json
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "..."}] }
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [{"meal": "Breakfast", "suggestion": "..."}],
    "notes": "..."
  },
  "notes": "One-line context for WhatsApp message"
}
\`\`\``;
}
