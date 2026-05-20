const { supabase, maskPhone } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000 cal', 'below 800 cal',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'crash diet', 'water fast'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeMessages } = await supabase
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .eq('direction', 'in')
      .ilike('body', '%Intake form submitted%')
      .limit(1);

    let intakeData = {};
    if (intakeMessages && intakeMessages[0]) {
      try {
        const jsonStr = intakeMessages[0].body.replace('Intake form submitted: ', '');
        intakeData = JSON.parse(jsonStr);
      } catch (e) { /* ignore parse errors */ }
    }

    const prompt = buildPrompt(client, intakeData, recentCheckins || [], week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error('Claude API error:', errText);
      return res.status(502).json({ error: 'Claude API failed' });
    }

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content[0].text;

    const lowerResponse = responseText.toLowerCase();
    const flagged = SAFETY_FLAGS.find(f => lowerResponse.includes(f));
    if (flagged) {
      await supabase.from('escalations').insert({
        phone: client.phone,
        reason: `Unsafe program content: "${flagged}"`,
        message_body: responseText.slice(0, 500)
      });
      console.error(`SAFETY FLAG: ${flagged} for ${maskPhone(client.phone)}`);
      return res.status(422).json({ error: 'Flagged for review', flag: flagged });
    }

    let workoutPlan, nutritionPlan;
    try {
      const parsed = JSON.parse(responseText);
      workoutPlan = parsed.workout_plan || parsed.workout;
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition;
    } catch (e) {
      workoutPlan = { raw: responseText };
      nutritionPlan = {};
    }

    const contextNote = generateContextNote(recentCheckins, week_no);

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: workoutPlan,
        nutrition_plan: nutritionPlan,
        notes: contextNote,
        pdf_url: null
      })
      .select()
      .single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      contextNote
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);
    return res.json({ ok: true, program_id: program.id });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  return `You are a program architect for an elite fitness coaching brand.
Generate a weekly training and nutrition program in JSON format.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Goal: ${intake.goal || 'fat loss + muscle retention'}
- Current Weight: ${intake.current_weight || 'unknown'}
- Target Weight: ${intake.target_weight || 'unknown'}
- Height: ${intake.height || 'unknown'}
- Injuries: ${intake.injuries || 'none reported'}
- Diet Preference: ${intake.diet_pref || 'no restrictions'}
- Schedule: ${intake.schedule || 'flexible'}
- Experience: ${intake.experience || 'intermediate'}
- Medical: ${intake.medical_conditions || 'none'}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

RULES:
- Output valid JSON only with keys: "workout_plan", "nutrition_plan", "weekly_summary"
- workout_plan: array of 6 training days with exercises, sets, reps, rest
- nutrition_plan: daily calories, macros (protein/carbs/fat in grams), 3 meal templates
- Never recommend below 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Progressive overload from previous weeks if check-in data available
- If compliance was low, simplify the plan slightly
- If energy was low, adjust volume down and add recovery notes
- Be specific with exercise names and rep ranges`;
}

function generateContextNote(checkins, weekNo) {
  if (!checkins || checkins.length === 0) {
    return "Welcome to Week 1! Let's build your foundation.";
  }
  const last = checkins[0];
  if (last.compliance_score >= 8) {
    return `Great consistency last week! Pushing intensity up for Week ${weekNo}.`;
  }
  if (last.compliance_score <= 5) {
    return `Adjusted this week for better adherence. Focus on consistency over perfection.`;
  }
  return `Week ${weekNo} program ready. Keep the momentum going!`;
}
