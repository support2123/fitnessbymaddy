const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000 calories', 'starvation',
  'banned substance', 'steroid', 'dnp', 'clenbuterol',
  'lose 10kg in 1 week', 'crash diet'
];

function checkSafety(plan) {
  const text = JSON.stringify(plan).toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (text.includes(flag)) return flag;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  const { data: client } = await db.from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  const { data: recentCheckins } = await db.from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: prevPrograms } = await db.from('programs')
    .select('workout_plan, nutrition_plan, notes')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(1);

  const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Design a weekly training and nutrition program. Be specific with exercises, sets, reps, rest times.
Nutrition must include daily calorie target, macro split, and a sample meal plan.
NEVER recommend extreme calorie cuts (below 1200 for women, 1500 for men).
NEVER recommend banned substances or unrealistic timelines.
Output strictly as JSON with two keys: "workout_plan" and "nutrition_plan".`;

  const userPrompt = `Client: ${client.name}
Program: ${client.program}
Week: ${week_no} of 12
Recent check-ins: ${JSON.stringify(recentCheckins || [])}
Previous program: ${JSON.stringify(prevPrograms?.[0] || 'None — first week')}

Design Week ${week_no} program. Adjust based on check-in compliance, energy, and any issues reported.`;

  let workoutPlan, nutritionPlan;

  try {
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
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    const claudeData = await claudeRes.json();
    const content = claudeData.content?.[0]?.text || '';

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Claude did not return valid JSON' });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    workoutPlan = parsed.workout_plan;
    nutritionPlan = parsed.nutrition_plan;
  } catch (e) {
    console.error('Claude API error:', e.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }

  const safetyIssue = checkSafety({ workoutPlan, nutritionPlan });
  if (safetyIssue) {
    const { createEscalation } = require('../lib/escalation');
    await createEscalation(
      'program',
      client_id,
      client.phone,
      `Safety flag: ${safetyIssue}`,
      `Week ${week_no} program flagged for review`
    );
    return res.status(200).json({
      success: false,
      halted: true,
      reason: safetyIssue
    });
  }

  const pdfUrl = `${client.folder_url}/week_${week_no}.pdf`;

  const { data: program, error } = await db.from('programs').insert({
    client_id,
    week_no,
    workout_plan: workoutPlan,
    nutrition_plan: nutritionPlan,
    pdf_url: pdfUrl,
    notes: `Auto-generated for week ${week_no}`
  }).select().single();

  if (error) {
    return res.status(500).json({ error: 'Failed to save program' });
  }

  await sendWhatsApp(client.phone, 'weekly_program', {
    name: client.name || 'there',
    templateParams: [
      client.name || 'there',
      String(week_no),
      'Your new week plan is ready! Check it out and let us know if you have questions.'
    ]
  });

  await db.from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('id', program.id);

  return res.status(200).json({
    success: true,
    program_id: program.id,
    week_no
  });
};
