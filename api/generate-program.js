const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, notifyMaddy, maskPhone } = require('./lib/whatsapp');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800', 'extreme deficit',
  'clenbuterol', 'dnp', 'steroid', 'sarm', 'ephedrine',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'very low calorie'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

async function callClaude(prompt) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Claude API error: ${resp.status} ${err}`);
  }

  const data = await resp.json();
  return data.content[0].text;
}

function buildPrompt(client, checkins, weekNo) {
  const lastTwo = checkins.slice(-2);
  const checkinSummary = lastTwo.map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`
  ).join('\n');

  return `You are a certified personal trainer and nutrition coach creating a weekly program for a fitness client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of 12
- Started: ${client.program_started_at}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins (Week 1)'}

INSTRUCTIONS:
1. Create a complete 7-day workout plan appropriate for their progress
2. Create a daily nutrition plan with macros and meal suggestions
3. Include a brief motivational note
4. Adjust intensity based on compliance and energy scores
5. Address any reported issues

SAFETY RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend any banned substances or supplements
- If the client reports pain or injury, recommend rest and medical consultation
- Keep timelines realistic (0.5-1kg per week fat loss max)

Return your response as valid JSON with this structure:
{
  "workout_plan": {
    "overview": "string",
    "days": [
      { "day": "Monday", "focus": "string", "exercises": [{ "name": "string", "sets": number, "reps": "string", "rest": "string" }] }
    ]
  },
  "nutrition_plan": {
    "calories": number,
    "protein_g": number,
    "carbs_g": number,
    "fats_g": number,
    "meals": [{ "meal": "string", "foods": ["string"], "approx_calories": number }]
  },
  "notes": "string"
}`;
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

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: true });

    const prompt = buildPrompt(client, checkins || [], week_no);
    const response = await callClaude(prompt);

    if (hasSafetyIssue(response)) {
      await notifyMaddy(
        'Program safety flag',
        `Client: ${maskPhone(client.phone)}, Week ${week_no}. AI output flagged for review.`
      );
      return res.status(200).json({
        success: false,
        reason: 'safety_review',
        message: 'Program flagged for manual review'
      });
    }

    let parsed;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
    } catch (parseErr) {
      console.error('Failed to parse Claude response');
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const { data: program, error } = await db.from('programs').upsert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.notes
    }, { onConflict: 'client_id,week_no' }).select().single();

    if (error) throw error;

    const summaryMsg = `Week ${week_no} program ready! ${parsed.notes || ''}`.slice(0, 200);
    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      summaryMsg
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
