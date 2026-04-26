const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendToMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/helpers');
const Anthropic = require('@anthropic-ai/sdk');

const UNSAFE_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /500\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|steroids?|sarms?/i,
  /lose\s*\d{2,}\s*kg.*week/i,
  /extreme\s*(cut|deficit|fast)/i
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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

    if (!client || client.status !== 'active') {
      return res.status(404).json({ error: 'Active client not found' });
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

    const prompt = buildPrompt(client, week_no, recentCheckins || [], lastProgram);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0]?.text || '';

    let parsed;
    try {
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/) ||
                         responseText.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch?.[1] || jsonMatch?.[0] || responseText;
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error('[Program] Failed to parse Claude response');
      await sendToMaddy(
        `Program generation failed for ${client.name || maskPhone(client.phone)} Week ${week_no}. Parse error.`
      );
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const fullText = JSON.stringify(parsed);
    const flagged = UNSAFE_PATTERNS.some(p => p.test(fullText));

    if (flagged) {
      await sendToMaddy(
        `FLAGGED: Program for ${client.name || maskPhone(client.phone)} Week ${week_no} contains risky content. Review needed.`
      );
      return res.status(200).json({ ok: true, flagged: true, message: 'Flagged for review' });
    }

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      workout_plan: parsed.workout_plan || parsed.workout || {},
      nutrition_plan: parsed.nutrition_plan || parsed.nutrition || {},
      notes: parsed.notes || parsed.coach_note || null,
      pdf_url: null
    }).select().single();

    const contextNote = parsed.notes || parsed.coach_note ||
      `Week ${week_no} program ready — keep pushing!`;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      contextNote.slice(0, 200)
    ]);

    if (program) {
      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString()
      }).eq('id', program.id);
    }

    return res.status(200).json({
      ok: true,
      program_id: program?.id,
      week_no
    });
  } catch (err) {
    console.error('[Program] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, weekNo, checkins, lastProgram) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  return `You are a certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program} (Week ${weekNo} of 12)
- Phone market: ${client.market || 'IN'}

RECENT CHECK-INS:
${checkinSummary || 'No check-in data yet (Week 1)'}

${lastProgram ? `LAST WEEK'S PROGRAM:
${JSON.stringify(lastProgram.workout_plan).slice(0, 500)}
Notes: ${lastProgram.notes || 'none'}` : ''}

INSTRUCTIONS:
- Create a complete 7-day workout plan and daily nutrition plan
- Adjust based on compliance, energy, and any reported issues
- If compliance is low, simplify slightly to rebuild momentum
- If energy is low, reduce volume but maintain intensity
- Progressive overload: slightly increase difficulty from last week
- Include Indian-friendly food options for IN market clients
- Be specific: sets, reps, rest periods, meal portions

SAFETY RULES (MANDATORY):
- Never recommend under 1400 calories for women or 1600 for men
- Never suggest any banned or controlled substances
- Never promise specific weight loss timelines
- If client reports pain or injury, recommend rest and medical consultation

Return a JSON object with this structure:
\`\`\`json
{
  "workout_plan": {
    "day_1": { "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "10-12", "rest": "60s"}] },
    "day_2": { ... },
    "rest_days": [4, 7]
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 200,
    "fats_g": 60,
    "meals": [
      {"meal": "Breakfast", "options": ["..."]},
      {"meal": "Lunch", "options": ["..."]},
      {"meal": "Dinner", "options": ["..."]},
      {"meal": "Snacks", "options": ["..."]}
    ]
  },
  "notes": "One-liner coach note for WhatsApp message",
  "coach_note": "Detailed notes about adjustments made this week"
}
\`\`\``;
}
