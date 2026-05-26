const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const { jsonResponse, errorResponse, handleOptions, PROGRAM_NAMES } = require('../lib/utils');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000 cal', 'below 800 cal',
  'banned substance', 'steroid', 'dnp', 'clenbuterol', 'ephedra',
  'lose 10kg in 1 week', 'crash diet', 'starvation'
];

function checkSafety(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const { client_id, week_no } = await req.json();
    if (!client_id || !week_no) return errorResponse('Missing client_id or week_no');

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return errorResponse('Client not found', 404);

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Generate a weekly training and nutrition program based on the client's profile and recent check-in data.

RULES:
- Be evidence-based. No bro-science.
- Calories never below 1200 for women, 1500 for men.
- No banned substances, no extreme protocols.
- Progressive overload principles.
- Adjust based on compliance score and energy levels.
- If the client reported pain or medical issues, flag for human review and provide a conservative plan.

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }
      ]}
    ],
    "cardio": "...",
    "notes": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meal_framework": [
      { "meal": "Breakfast", "suggestion": "...", "macros": "..." }
    ],
    "notes": "..."
  },
  "weekly_focus": "...",
  "coach_note": "..."
}`;

    const userPrompt = `Client Profile:
- Name: ${client.name || 'N/A'}
- Program: ${PROGRAM_NAMES[client.program] || client.program}
- Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}
- Started: ${client.program_started_at}

Recent Check-ins:
${recentCheckins?.map(c => `  Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n') || '  No previous check-ins'}

Previous Program Notes:
${prevPrograms?.[0]?.notes || 'First week — no previous program'}

Generate the Week ${week_no} program.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;

    if (checkSafety(responseText)) {
      await escalateToMaddy('Program safety flag', {
        phone: client.phone,
        details: `Week ${week_no} program flagged for safety review. Auto-generation halted.`
      });
      return jsonResponse({ ok: false, reason: 'safety_flagged' });
    }

    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse Claude response');
      return errorResponse('Failed to parse program output', 500);
    }

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.coach_note || parsed.weekly_focus || null
    }).select().single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      week_no.toString(),
      parsed.weekly_focus || 'New week, new gains!'
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return jsonResponse({ ok: true, program_id: program.id });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return errorResponse('Internal error', 500);
  }
};
