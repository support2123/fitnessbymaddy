const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { json, cors, maskPhone } = require('../lib/utils');
const Anthropic = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body || {};
    if (!client_id || !week_no) {
      return json(res, { error: 'client_id and week_no required' }, 400);
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return json(res, { error: 'Client not found' }, 404);

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes, week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are "Program Architect" for FitnessByMaddy, an elite online fitness coaching brand.
You create weekly personalised workout + nutrition plans.

RULES:
- Never prescribe extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned/controlled substances
- Never promise specific weight loss timelines
- Base progression on the client's check-in data
- If the client reports pain or medical issues, flag for human review instead of programming around it
- Output valid JSON only

OUTPUT FORMAT (strict JSON):
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "cardio": { "sessions_per_week": 3, "type": "LISS or HIIT", "duration": "20-30 min" }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "3-4L water daily"
  },
  "coach_note": "One-liner context for this week",
  "flag_for_review": false
}`;

    const checkinSummary = recentCheckins && recentCheckins.length > 0
      ? recentCheckins.map(c =>
          `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
        ).join('\n')
      : 'No previous check-ins available.';

    const prevProgramSummary = prevPrograms && prevPrograms.length > 0
      ? `Previous week ${prevPrograms[0].week_no} plan summary: ${prevPrograms[0].notes || 'Standard progression'}`
      : 'First week — no previous program.';

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}

RECENT CHECK-INS:
${checkinSummary}

PREVIOUS PROGRAM:
${prevProgramSummary}

Create an appropriate Week ${week_no} progression. If any check-in reports pain, injury, or concerning symptoms, set flag_for_review=true and explain in coach_note.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;
    let programData;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch {
      return json(res, { error: 'Failed to parse program output', raw: rawText.slice(0, 500) }, 500);
    }

    if (programData.flag_for_review) {
      await db.from('escalations').insert({
        phone: client.phone,
        client_id: client.id,
        reason: `Program flagged for review: ${programData.coach_note || 'AI flagged'}`,
        message_body: JSON.stringify(programData).slice(0, 1000),
      });
      return json(res, {
        ok: true,
        flagged: true,
        note: programData.coach_note,
        message: 'Program flagged for Maddy review — not auto-sent',
      });
    }

    const { data: program, error } = await db
      .from('programs')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        workout_plan: programData.workout_plan || {},
        nutrition_plan: programData.nutrition_plan || {},
        notes: programData.coach_note || null,
      })
      .select()
      .single();

    if (error) throw error;

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      week_no.toString(),
      programData.coach_note || `Week ${week_no} plan is ready!`,
    ]);

    await db
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return json(res, { ok: true, program_id: program.id, week_no });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
