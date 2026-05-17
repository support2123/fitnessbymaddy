const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { logMessage } = require('../lib/rate-limit');

const PROGRAM_ARCHITECT_PROMPT = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Generate a weekly workout + nutrition plan for the client based on their profile and recent check-ins.

RULES:
- Never prescribe extreme calorie cuts (below 1200 kcal for women, 1500 for men)
- Never recommend banned/dangerous substances
- Never set unrealistic timelines
- Be specific: sets, reps, rest periods, exercise names
- Nutrition: meals with approximate calories, macros, and easy alternatives
- Consider any reported injuries, pain, or medical conditions
- If PCOS program: focus on insulin-sensitive nutrition, strength + low-impact cardio
- If 40+: joint-friendly movements, mobility work, realistic recovery

Output VALID JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "...", "sets": 3, "reps": "10-12", "rest": "60s", "notes": "" }
      ]}
    ],
    "cardio": { "frequency": "...", "type": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "daily_calories": 1800,
    "macros": { "protein_g": 140, "carbs_g": 180, "fat_g": 60 },
    "meals": [
      { "meal": "Breakfast", "options": ["..."], "approx_cal": 400 }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "One paragraph context for the client"
}`;

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .limit(1)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const clientContext = buildClientContext(client, checkins || [], week_no);

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
        messages: [
          {
            role: 'user',
            content: `${PROGRAM_ARCHITECT_PROMPT}\n\nCLIENT DATA:\n${clientContext}\n\nGenerate Week ${week_no} program. Return ONLY valid JSON.`,
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error(`Claude API error: ${claudeRes.status} ${errText}`);
    }

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content[0].text;

    let programData;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch (parseErr) {
      throw new Error('Failed to parse Claude response as JSON');
    }

    if (isFlagged(programData)) {
      const { createEscalation } = require('../lib/escalation');
      await createEscalation(
        client.phone,
        client.id,
        'Program flagged for review - potentially risky content',
        JSON.stringify(programData).slice(0, 500)
      );
      return res.status(200).json({
        success: false,
        reason: 'flagged_for_review',
        message: 'Program flagged for Maddy review before sending',
      });
    }

    const { data: program, error } = await db
      .from('programs')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.notes,
        generated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      programData.notes || 'Your new plan is ready!',
    ]);

    await db
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    await logMessage(client.phone, 'out', `Week ${week_no} program sent`, 'weekly_program');

    return res.status(200).json({
      success: true,
      program_id: program.id,
      week_no,
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildClientContext(client, checkins, weekNo) {
  let ctx = `Name: ${client.name || 'Unknown'}\n`;
  ctx += `Program: ${client.program}\n`;
  ctx += `Week: ${weekNo} of ${client.program === '12wk' ? 12 : client.program === 'pcos' ? 8 : 6}\n`;
  ctx += `Started: ${client.program_started_at}\n`;

  if (checkins.length > 0) {
    ctx += '\nRecent Check-ins:\n';
    for (const ci of checkins) {
      ctx += `  Week ${ci.week_no}: weight=${ci.weight}kg, waist=${ci.waist}cm, compliance=${ci.compliance_score}/10, energy=${ci.energy}/10`;
      if (ci.issues) ctx += `, issues: ${ci.issues}`;
      ctx += '\n';
    }
  } else {
    ctx += '\nNo previous check-ins (first week).\n';
  }

  return ctx;
}

function isFlagged(data) {
  const cal = data?.nutrition_plan?.daily_calories;
  if (cal && cal < 1200) return true;

  const notes = JSON.stringify(data).toLowerCase();
  const banned = ['steroid', 'dnp', 'clenbuterol', 'ephedra', 'sarm'];
  return banned.some(b => notes.includes(b));
}
