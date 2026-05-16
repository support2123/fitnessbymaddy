const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { logMessage } = require('./lib/rate-limit');

const SYSTEM_PROMPT = `You are a certified fitness program architect for FitnessByMaddy.
Generate a weekly training and nutrition plan based on the client's profile and recent check-ins.

Rules:
- Never prescribe extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned substances or unregulated supplements
- Never promise specific weight loss timelines
- Adjust intensity based on compliance and energy scores
- If the client reports pain or medical issues, flag for human review
- Include progressive overload principles
- Tailor nutrition to dietary preferences

Output JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [...] }
    ],
    "notes": "string"
  },
  "nutrition_plan": {
    "calories": number,
    "protein_g": number,
    "carbs_g": number,
    "fats_g": number,
    "meals": [...],
    "notes": "string"
  },
  "weekly_focus": "string",
  "flag_for_review": boolean,
  "flag_reason": "string or null"
}`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  const { data: checkins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: intake } = await db
    .from('intake_forms')
    .select('*')
    .eq('lead_id', client.lead_id)
    .single();

  const clientContext = {
    name: client.name,
    program: client.program,
    week_no,
    recent_checkins: checkins || [],
    intake: intake || {},
    program_started: client.program_started_at
  };

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
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Generate Week ${week_no} program for this client:\n\n${JSON.stringify(clientContext, null, 2)}`
      }]
    })
  });

  if (!claudeRes.ok) {
    const err = await claudeRes.text();
    return res.status(500).json({ error: 'Claude API failed', detail: err });
  }

  const claudeData = await claudeRes.json();
  const responseText = claudeData.content[0].text;

  let programData;
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    programData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to parse program JSON', raw: responseText });
  }

  if (programData.flag_for_review) {
    const { sendTemplate: notify } = require('./lib/whatsapp');
    await notify('+917082478374', 'escalation_alert', [
      'Program flagged for review',
      client.name,
      programData.flag_reason || 'Auto-flagged by AI'
    ]);
  }

  const { error: insertError } = await db.from('programs').insert({
    client_id,
    week_no,
    generated_at: new Date().toISOString(),
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: programData.weekly_focus || ''
  });

  if (insertError) {
    return res.status(500).json({ error: 'Failed to store program', detail: insertError.message });
  }

  if (!programData.flag_for_review) {
    await sendTemplate(client.phone, 'weekly_program', [
      client.name,
      `Week ${week_no}`,
      programData.weekly_focus || 'New program ready!'
    ]);
    await logMessage(client.phone, 'out', `[Week ${week_no} program sent]`, 'weekly_program');

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);
  }

  return res.status(200).json({
    success: true,
    client_id,
    week_no,
    flagged: programData.flag_for_review || false
  });
};
