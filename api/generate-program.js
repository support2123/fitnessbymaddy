const { getSupabase } = require('./lib/supabase');
const { sendTemplate, maskPhone } = require('./lib/whatsapp');
const { notifyMaddy } = require('./lib/escalation');
const { logMessage } = require('./lib/rate-limit');

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

const SAFETY_FLAGS = [
  'very low calorie', 'vlcd', 'below 1000', 'under 800',
  'clenbuterol', 'dnp', 'ephedra', 'sarm', 'steroid',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'extreme fasting', 'no food',
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

async function callClaude(prompt) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY not configured');

  const res = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || '';
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const supabase = getSupabase();

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (client.program !== '12wk') {
      return res.status(400).json({ error: 'Program generation is for 12-week clients only' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const checkinSummary = (recentCheckins || []).map(c => (
      `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, ` +
      `Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, ` +
      `Issues: ${c.issues || 'none'}`
    )).join('\n');

    const prompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.

Create Week ${week_no} of a 12-week custom training and nutrition program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program started: ${client.program_started_at}
- Current week: ${week_no} of 12

RECENT CHECK-IN DATA:
${checkinSummary || 'No check-in data yet (first week)'}

INSTRUCTIONS:
1. Design a progressive workout plan (5-6 days, push/pull/legs or upper/lower split)
2. Design a nutrition plan with daily calorie target, macros, and sample meals
3. Include a brief coach's note with encouragement and focus areas
4. Be evidence-based and safe. No extreme measures.

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown:
{
  "workout_plan": {
    "split": "push/pull/legs",
    "days": [
      {
        "day": "Day 1 - Push",
        "exercises": [
          {"name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": ""}
        ]
      }
    ],
    "cardio": "description of weekly cardio recommendation",
    "deload_note": ""
  },
  "nutrition_plan": {
    "daily_calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      {"meal": "Breakfast", "description": "...", "calories": 500}
    ],
    "hydration": "3L water daily",
    "supplements": ["Whey protein", "Creatine 5g"]
  },
  "coach_note": "Great progress this week..."
}`;

    const response = await callClaude(prompt);

    if (hasSafetyIssue(response)) {
      await notifyMaddy(
        'Program safety flag',
        `Client ${client.name || maskPhone(client.phone)} Week ${week_no} — generated content flagged for review`
      );
      return res.status(200).json({
        ok: false,
        reason: 'safety_flag',
        message: 'Program flagged for manual review',
      });
    }

    let parsed;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
    } catch (parseErr) {
      console.error('Failed to parse Claude response:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        workout_plan: parsed.workout_plan || {},
        nutrition_plan: parsed.nutrition_plan || {},
        notes: parsed.coach_note || '',
      })
      .select('id')
      .single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      parsed.coach_note ? parsed.coach_note.slice(0, 100) : 'Your new program is ready!',
    ]);
    await logMessage(client.phone, 'out', `Week ${week_no} program sent`, 'weekly_program');

    if (program) {
      await supabase
        .from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);
    }

    return res.status(200).json({ ok: true, programId: program?.id });
  } catch (err) {
    console.error('Generate program error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
