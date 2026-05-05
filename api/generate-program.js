const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800', 'steroids', 'sarms', 'dnp',
  'clenbuterol', 'extreme fasting', '0 carb', 'no food',
  '500 calorie', 'laxative', 'diuretic'
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intake } = await supabase
      .from('lead_intake')
      .select('*')
      .eq('lead_id', client.lead_id)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Design science-backed, progressive training and nutrition plans.
Be specific with sets, reps, rest periods, and exact macro targets.
Never recommend extreme calorie restriction (<1200 for women, <1500 for men),
banned substances, or unrealistic timelines.
Output strictly valid JSON with keys: workout_plan, nutrition_plan, notes.`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Started: ${client.program_started_at}
${intake ? `- Age: ${intake.age}, Gender: ${intake.gender}
- Goal: ${intake.goal}
- Injuries/conditions: ${intake.injuries || 'None'}
- Diet preference: ${intake.diet_preference || 'No restriction'}
- Workout days/week: ${intake.workout_days || 5}
- Equipment: ${intake.equipment_access || 'Full gym'}
- Current weight: ${intake.current_weight || 'Unknown'}
- Target weight: ${intake.target_weight || 'Not specified'}` : ''}

RECENT CHECK-INS:
${checkins && checkins.length > 0 ? checkins.map(c =>
  `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`
).join('\n') : 'No previous check-ins (Week 1)'}

Return JSON only. Structure:
{
  "workout_plan": { "days": [{ "day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..."}] }] },
  "nutrition_plan": { "calories": 0, "protein_g": 0, "carbs_g": 0, "fats_g": 0, "meal_timing": [...], "notes": "..." },
  "notes": "Coach notes for the week..."
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;

    if (hasSafetyIssue(rawText)) {
      const { sendTemplate: sendWA } = require('./lib/whatsapp');
      await sendWA('+917082478374', 'escalation_alert', [
        'Unsafe program content generated',
        client.phone.slice(-4),
        `Week ${week_no} flagged for review`
      ]);
      return res.status(200).json({ flagged: true, reason: 'safety_review' });
    }

    let programData;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch (parseErr) {
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const { error: insertError } = await supabase.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes
    });

    if (insertError) {
      console.error('Program save error:', insertError.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    await sendTemplate(client.phone, 'program_ready', [
      client.name || 'there',
      String(week_no),
      programData.notes ? programData.notes.slice(0, 100) : 'Your new week is ready!'
    ]);

    return res.status(200).json({ success: true, week_no });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
