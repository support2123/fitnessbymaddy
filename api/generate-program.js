const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

const SAFETY_KEYWORDS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'dnp', 'clenbuterol', 'ephedra',
  '30 days to six pack', 'lose 10kg in a week',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevProgram } = await db
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const prompt = buildPrompt(client, recentCheckins || [], prevProgram?.[0] || null, week_no);

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
      console.error('Claude API error:', errText);
      return res.status(502).json({ error: 'Claude API call failed' });
    }

    const claudeData = await claudeRes.json();
    const rawContent = claudeData.content?.[0]?.text || '';

    const flagged = SAFETY_KEYWORDS.some((kw) => rawContent.toLowerCase().includes(kw));
    if (flagged) {
      await escalateToMaddy('Safety flag in generated program', {
        phone: maskPhone(client.phone),
        message: `Week ${week_no} program flagged for review`,
      });
      return res.status(200).json({ ok: false, reason: 'flagged_for_review' });
    }

    let parsed;
    try {
      const jsonMatch = rawContent.match(/```json\s*([\s\S]*?)```/) || rawContent.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : rawContent);
    } catch {
      parsed = { workout_plan: rawContent, nutrition_plan: null };
    }

    const workoutPlan = parsed.workout_plan || parsed.workout || parsed;
    const nutritionPlan = parsed.nutrition_plan || parsed.nutrition || null;
    const notes = parsed.notes || parsed.coach_note || '';

    const { error: insertErr } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: typeof workoutPlan === 'string' ? { raw: workoutPlan } : workoutPlan,
      nutrition_plan: typeof nutritionPlan === 'string' ? { raw: nutritionPlan } : nutritionPlan,
      notes,
      pdf_url: null,
    });

    if (insertErr) {
      console.error('program insert error:', insertErr);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const contextNote = notes
      || `Week ${week_no} program ready — keep pushing!`;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      contextNote.slice(0, 200),
    ]);

    return res.status(200).json({ ok: true, week_no });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, prevProgram, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of 12
- Started: ${client.program_started_at}

${lastCheckin ? `LAST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None'}
` : 'No previous check-in data available.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Waist: ${prevCheckin.waist || 'N/A'} cm
` : ''}

${prevProgram ? `PREVIOUS PROGRAM NOTES: ${prevProgram.notes || 'None'}` : ''}

INSTRUCTIONS:
1. Create a complete workout plan for the week (5-6 training days + 1-2 rest days)
2. Create a nutrition plan with macros and meal suggestions
3. Include a short coach's note (1-2 sentences, warm and motivating, Hinglish if Indian client)
4. Adjust intensity based on compliance and energy scores
5. Address any issues mentioned

SAFETY RULES — NEVER include:
- Calorie targets below 1200 for women or 1500 for men
- Any banned substances or supplements
- Unrealistic timelines or promises
- Exercises that could aggravate reported issues

Respond in JSON format:
{
  "workout_plan": { "day1": {...}, "day2": {...}, ... },
  "nutrition_plan": { "calories": ..., "protein": ..., "carbs": ..., "fat": ..., "meals": [...] },
  "notes": "Coach's note here"
}`;
}
