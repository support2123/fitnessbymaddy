const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

const RISKY_TERMS = [
  'below 1200 calories', 'below 1000 calories', '800 cal', '500 cal',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'crash diet', 'water fast',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  try {
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

    const { data: lead } = client.lead_id
      ? await db.from('leads').select('first_msg').eq('id', client.lead_id).single()
      : { data: null };

    const intakeData = lead?.first_msg ? tryParseJSON(lead.first_msg) : null;

    const anthropic = new Anthropic();
    const prompt = buildPrompt(client, intakeData, recentCheckins, week_no);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content[0].text;

    if (containsRiskyContent(responseText)) {
      await escalateToMaddy(
        'Risky content in generated program',
        client.phone,
        `Week ${week_no} program flagged for review`
      );
      return res.json({ ok: false, reason: 'Flagged for review', week_no });
    }

    const parsed = parseProgram(responseText);

    const { data: program, error } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: parsed.workout,
      nutrition_plan: parsed.nutrition,
      notes: parsed.notes,
    }).select().single();

    if (error) throw error;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      parsed.notes || 'New week, new gains!',
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    return res.json({ ok: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const checkinSummary = checkins?.length
    ? checkins.map(c =>
        `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, ` +
        `Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, ` +
        `Issues: ${c.issues || 'none'}`
      ).join('\n')
    : 'No prior check-ins yet.';

  const intakeInfo = intake
    ? `Age: ${intake.age}, Goal: ${intake.goal}, Injuries: ${intake.injuries || 'none'}, ` +
      `Diet: ${intake.diet_preference || 'flexible'}, Schedule: ${intake.schedule || 'standard'}, ` +
      `Medical: ${intake.medical_conditions || 'none'}`
    : 'No intake data available.';

  return `You are a program architect for FitnessByMaddy, an elite online fitness coaching brand.

Generate Week ${weekNo} training and nutrition plan for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- ${intakeInfo}

RECENT CHECK-INS:
${checkinSummary}

RULES:
- Be science-based and progressive (build on previous weeks)
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Include warm-up and cool-down in every session
- Nutrition should be practical and culturally appropriate
- If client reports pain or injury, reduce intensity and note for review

OUTPUT FORMAT (respond in valid JSON only):
{
  "workout": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min incline walk + arm circles",
        "cooldown": "5 min stretching"
      }
    ],
    "cardio": "3x per week, 20 min moderate intensity",
    "steps_target": 8000
  },
  "nutrition": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fats_g": 60,
    "meal_plan": [
      { "meal": "Breakfast", "option": "Oats + whey protein + banana", "calories": 400 }
    ],
    "hydration": "3L water daily",
    "supplements": ["Whey protein", "Creatine 5g"]
  },
  "notes": "One-liner context note for the client about this week's focus."
}`;
}

function parseProgram(text) {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        workout: parsed.workout || null,
        nutrition: parsed.nutrition || null,
        notes: parsed.notes || null,
      };
    }
  } catch (e) {
    // fall through
  }
  return { workout: null, nutrition: null, notes: text.slice(0, 200) };
}

function containsRiskyContent(text) {
  const lower = text.toLowerCase();
  return RISKY_TERMS.some(term => lower.includes(term));
}

function tryParseJSON(str) {
  try { return JSON.parse(str); } catch { return null; }
}
