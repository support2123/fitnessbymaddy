const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { escalate } = require('./_lib/escalation');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'crash diet'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .maybeSingle();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lead } = await supabase
      .from('leads')
      .select('first_msg')
      .eq('id', client.lead_id)
      .maybeSingle();

    let intakeData = {};
    try { intakeData = JSON.parse(lead?.first_msg || '{}'); } catch { /* noop */ }

    const prompt = buildProgramPrompt(client, intakeData, checkins || [], week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error('Claude API error:', errText);
      return res.status(502).json({ error: 'Program generation failed' });
    }

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content[0].text;

    const isSafe = !SAFETY_FLAGS.some(flag => responseText.toLowerCase().includes(flag));
    if (!isSafe) {
      await escalate(client.phone, 'unsafe_program_generated', `Week ${week_no}: flagged content in generated program`);
      return res.json({ success: false, reason: 'safety_flagged', week_no });
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const parsed = JSON.parse(responseText);
      workoutPlan = parsed.workout;
      nutritionPlan = parsed.nutrition;
      notes = parsed.notes;
    } catch {
      workoutPlan = { raw: responseText };
      nutritionPlan = {};
      notes = 'Auto-parsed from text response';
    }

    const { error: progError } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes
    });

    if (progError) {
      console.error('Program save error:', progError.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    await sendWhatsApp(client.phone, 'program_ready', [
      client.name || 'there',
      `Week ${week_no}`,
      notes || 'Your new program is ready! Check it out and let us know if you have questions.'
    ]);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.json({ success: true, client_id, week_no });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, intake, checkins, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a certified fitness program architect for Fitness by Maddy, an elite online coaching brand.

Generate a complete weekly program for Week ${weekNo} of a 12-week custom training program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
- Goal: ${intake.goal || 'general fitness'}
- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Training Experience: ${intake.training_experience || 'unknown'}
- Gym Access: ${intake.gym_access || 'yes'}
- Injuries/Limitations: ${intake.injuries || 'none reported'}
- Diet Preference: ${intake.diet_preference || 'no restrictions'}
- Current Weight: ${intake.current_weight || 'unknown'}
- Target Weight: ${intake.target_weight || 'unknown'}
- Height: ${intake.height || 'unknown'}

${lastCheckin ? `LAST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'}
- Waist: ${lastCheckin.waist || 'N/A'}
- Compliance: ${lastCheckin.compliance_score}/10
- Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'none'}` : 'No previous check-in data available.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'}
- Compliance: ${prevCheckin.compliance_score}/10
- Energy: ${prevCheckin.energy}/10` : ''}

RULES:
- Never prescribe extreme calorie deficits (below 1200 for women, below 1500 for men)
- Never recommend banned substances or steroids
- Never promise unrealistic timelines
- Adjust intensity based on compliance and energy scores
- If injuries are reported, provide modifications
- Be specific with sets, reps, rest periods
- Include warm-up and cool-down

Respond ONLY with valid JSON in this format:
{
  "workout": {
    "days": [
      {"day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..."}]},
      ...
    ],
    "warmup": "...",
    "cooldown": "..."
  },
  "nutrition": {
    "calories": 2200,
    "protein_g": 150,
    "carbs_g": 250,
    "fat_g": 70,
    "meal_plan": [
      {"meal": "Breakfast", "options": ["...", "..."]},
      ...
    ],
    "supplements": ["...", "..."],
    "hydration": "..."
  },
  "notes": "Brief 1-2 sentence personalized note for the client about this week's focus."
}`;
}
