const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { sendText } = require('./lib/whatsapp');
const { cors, maskPhone } = require('./lib/utils');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const RISKY_PATTERNS = [
  /below\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarm/i,
  /lose\s*\d{2,}\s*(kg|lbs?)\s*(in|per)\s*(1|one|a)\s*week/i,
  /extreme.?cut/i,
];

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
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
      .select('*, lead:leads(*)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await db
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: existingProgram } = await db
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existingProgram) {
      return res.status(409).json({ error: 'Program already generated for this week' });
    }

    const anthropic = new Anthropic();

    const systemPrompt = `You are the Program Architect for Fitness by Maddy, an elite online coaching brand. Generate a personalised weekly workout and nutrition plan based on the client data provided.

Rules:
- Be evidence-based. No bro-science.
- Calorie targets must be reasonable (never below 1400 for women, 1600 for men).
- No banned substances or supplements that require prescription.
- Factor in injuries, medical conditions, and diet preferences.
- Be specific: exercise names, sets, reps, rest, tempo.
- Nutrition: macros, meal timing, sample meals matching diet preference.
- Respond ONLY with valid JSON matching the schema below.

JSON Schema:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "..." }
        ],
        "cardio": "...",
        "duration_mins": 60
      }
    ],
    "deload_notes": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "...",
    "notes": "..."
  },
  "weekly_focus": "...",
  "coach_note": "..."
}`;

    const clientProfile = JSON.stringify({
      name: client.name,
      program: client.program,
      week: week_no,
      intake: intake || {},
      recent_checkins: recentCheckins || [],
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Generate Week ${week_no} program for this client:\n${clientProfile}`,
        },
      ],
    });

    const rawText = response.content[0].text;

    const isRisky = RISKY_PATTERNS.some((p) => p.test(rawText));
    if (isRisky) {
      await sendText(
        MADDY_PHONE,
        `⚠️ Program flagged for review\nClient: ${client.name || maskPhone(client.phone)}\nWeek ${week_no}\nReason: Potentially risky content detected. Please review before sending.`
      );
      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: { flagged: true, raw: rawText },
        nutrition_plan: { flagged: true },
        notes: 'FLAGGED — awaiting Maddy review',
      });
      return res.json({ ok: true, flagged: true });
    }

    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch (_) {
      parsed = { raw: rawText };
    }

    const { data: program } = await db
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: parsed.workout_plan || parsed,
        nutrition_plan: parsed.nutrition_plan || {},
        notes: parsed.coach_note || parsed.weekly_focus || null,
      })
      .select()
      .single();

    const weekNote = parsed.weekly_focus || `Week ${week_no} plan ready`;
    await sendText(
      client.phone,
      `📋 Your Week ${week_no} program is ready!\n\n🎯 Focus: ${weekNote}\n\nCheck your plan and let us know if you have any questions. Let's crush it! 💪`
    );

    await db
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.json({ ok: true, program_id: program.id });
  } catch (err) {
    console.error('Program gen error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};
