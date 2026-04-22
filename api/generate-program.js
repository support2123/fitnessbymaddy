const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/helpers');
const { escalate } = require('./_lib/escalation');

const SAFETY_PATTERNS = [
  /\b(less than 1[0-2]00\s*cal)/i,
  /\b(dnp|clenbuterol|ephedra|sibutramine|sarm)/i,
  /\b(lose\s+\d{2,}\s*(kg|lb|pound).*(?:week|day))/i,
  /\b(starvation|extreme.?cut|zero.?carb.?diet)\b/i,
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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const prompt = buildProgramPrompt(client, recentCheckins || [], prevProgram, week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error('[CLAUDE API ERROR]', errText);
      return res.status(502).json({ error: 'AI generation failed' });
    }

    const claudeData = await claudeRes.json();
    const content = claudeData.content?.[0]?.text || '';

    for (const pattern of SAFETY_PATTERNS) {
      if (pattern.test(content)) {
        await escalate(
          client.phone,
          'unsafe_program_content',
          `Pattern matched: ${pattern.source} in week ${week_no} program`,
          client_id
        );

        await db.from('programs').insert({
          client_id,
          week_no,
          workout_plan: null,
          nutrition_plan: null,
          notes: `FLAGGED: Safety pattern matched — ${pattern.source}`,
          flagged_for_review: true,
        });

        return res.status(200).json({ action: 'flagged_for_review' });
      }
    }

    let workoutPlan, nutritionPlan, contextNote;
    try {
      const parsed = JSON.parse(extractJSON(content));
      workoutPlan = parsed.workout_plan || parsed.workout || null;
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition || null;
      contextNote = parsed.context_note || parsed.note || '';
    } catch {
      workoutPlan = { raw: content };
      nutritionPlan = null;
      contextNote = '';
    }

    const { data: program } = await db
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: workoutPlan,
        nutrition_plan: nutritionPlan,
        notes: contextNote,
        flagged_for_review: false,
      })
      .select()
      .single();

    await sendWhatsApp(client.phone, 'weekly_program_v1', [
      client.name || 'there',
      `Week ${week_no}`,
      contextNote || 'Your new program is ready!',
    ]);

    if (program) {
      await db
        .from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);
    }

    console.log(`[PROGRAM] Generated week ${week_no} for ${maskPhone(client.phone)}`);
    return res.status(200).json({ success: true, program_id: program?.id });
  } catch (err) {
    console.error('[GENERATE ERROR]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, checkins, prevProgram, weekNo) {
  const profile = [
    `Name: ${client.name || 'Client'}`,
    `Program: ${client.program}`,
    `Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}`,
    client.age ? `Age: ${client.age}` : null,
    client.goal ? `Goal: ${client.goal}` : null,
    client.injuries ? `Injuries/limitations: ${client.injuries}` : null,
    client.diet_pref ? `Diet preference: ${client.diet_pref}` : null,
    client.schedule ? `Training schedule: ${client.schedule}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const checkinSummary =
    checkins.length > 0
      ? checkins
          .map(
            (c) =>
              `Week ${c.week_no}: weight=${c.weight || 'N/A'}, waist=${c.waist || 'N/A'}, ` +
              `compliance=${c.compliance_score || 'N/A'}/10, energy=${c.energy || 'N/A'}/10` +
              (c.issues ? `, issues: ${c.issues}` : '')
          )
          .join('\n')
      : 'No check-in data yet (first week).';

  const prevNotes = prevProgram
    ? `Previous program notes: ${prevProgram.notes || 'None'}`
    : 'No previous program.';

  return `You are "Program Architect", Maddy's AI assistant for FitnessByMaddy.
Generate a complete weekly training and nutrition program for this client.

CLIENT PROFILE:
${profile}

RECENT CHECK-INS:
${checkinSummary}

${prevNotes}

RULES:
- Be warm, encouraging, expert. Never bro-sciency.
- No extreme calorie deficits (minimum 1200 kcal women, 1500 kcal men).
- No banned substances or supplements.
- No unrealistic promises (max 1kg/2lb fat loss per week is realistic).
- Account for injuries and limitations.
- Progressive overload from previous week where applicable.
- Include rest days and mobility work.

OUTPUT FORMAT (respond ONLY with this JSON):
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "notes": "..." }
      ]},
      ...
    ],
    "cardio": "...",
    "rest_days": "..."
  },
  "nutrition_plan": {
    "daily_calories": ...,
    "protein_g": ...,
    "carbs_g": ...,
    "fat_g": ...,
    "meal_ideas": ["...", "..."],
    "hydration": "...",
    "supplements": "..."
  },
  "context_note": "1-2 sentence summary for WhatsApp message to client"
}`;
}

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}
