const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate, maskPhone } = require('./lib/whatsapp');
const { notifyMaddy } = require('./lib/whatsapp');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(f => lower.includes(f));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const prompt = buildProgramPrompt(client, recentCheckins || [], lastProgram, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0].text;

    if (hasSafetyIssue(responseText)) {
      await notifyMaddy(
        'Program flagged for safety review',
        `Client: ${maskPhone(client.phone)}, Week ${week_no}\nAI output contains potentially unsafe recommendations. Please review before sending.`
      );
      return res.status(200).json({ ok: false, reason: 'safety_flagged' });
    }

    let parsed;
    try {
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : responseText);
    } catch {
      parsed = { workout_plan: {}, nutrition_plan: {}, notes: responseText };
    }

    const { error } = await db.from('programs').upsert({
      client_id,
      week_no,
      workout_plan: parsed.workout_plan || {},
      nutrition_plan: parsed.nutrition_plan || {},
      notes: parsed.notes || '',
      generated_at: new Date().toISOString()
    }, { onConflict: 'client_id,week_no' });

    if (error) {
      console.error('Program save error:', error.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      parsed.notes?.slice(0, 100) || 'Your new program is ready!'
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ ok: true, week_no });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, checkins, lastProgram, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
  ).join('\n');

  return `You are a certified fitness coach designing a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins (first week)'}

${lastProgram ? `LAST WEEK'S PROGRAM NOTES: ${lastProgram.notes || 'None'}` : ''}

RULES:
- Design a progressive, safe program
- Never recommend below 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Include rest days
- Account for any reported issues or injuries
- Be specific with sets, reps, weights (relative), rest periods

OUTPUT FORMAT (return valid JSON only, wrapped in \`\`\`json code block):
\`\`\`json
{
  "workout_plan": {
    "day_1": { "name": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "..."}] },
    "day_2": { "name": "...", "exercises": [...] },
    "rest_days": [4, 7]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meal_timing": "...",
    "notes": "..."
  },
  "notes": "One-liner context for WhatsApp message"
}
\`\`\``;
}
