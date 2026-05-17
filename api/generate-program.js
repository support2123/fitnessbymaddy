const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'starvation',
  'clenbuterol', 'dnp', 'ephedrine', 'steroid', 'sarm',
  'lose 10kg in 1 week', '20 pounds in 2 weeks'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: existingProgram } = await supabase
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existingProgram) {
      return res.status(409).json({ error: 'Program already generated for this week' });
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy coaching.
Generate a weekly training and nutrition program based on the client's profile and recent check-in data.

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {"day": "Monday", "focus": "Upper Body Push", "exercises": [{"name": "", "sets": 0, "reps": "", "rest": "", "notes": ""}]},
      ...
    ],
    "cardio": {"type": "", "frequency": "", "duration": ""},
    "deload_notes": ""
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_timing": "",
    "hydration": "",
    "supplements": [],
    "notes": ""
  },
  "weekly_focus": "",
  "motivation_note": ""
}

Rules:
- Never prescribe below 1200 calories for women or 1500 for men
- No banned substances or unrealistic timelines
- Adjust based on compliance score and energy levels from check-ins
- If client reports pain/injury, reduce volume and suggest physio referral
- Progressive overload week to week
- Include deload if compliance < 6 or energy < 5`;

    const clientContext = `Client: ${client.name || 'Unknown'}
Age: ${client.age || 'Not specified'}
Goal: ${client.goal || 'General fitness'}
Injuries: ${client.injuries || 'None reported'}
Diet preference: ${client.diet_preference || 'No restrictions'}
Schedule: ${client.schedule || 'Flexible'}
Program: ${client.program}
Current week: ${week_no}

Recent check-ins:
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')
  : 'No previous check-ins (first week)'}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: clientContext }]
    });

    const programText = response.content[0].text;

    if (hasSafetyIssue(programText)) {
      const { escalate } = require('./lib/escalation');
      await escalate(client.phone, 'unsafe_program_generated', `Week ${week_no} program flagged for safety review`, client_id);
      return res.status(200).json({ success: false, reason: 'safety_flagged', needs_review: true });
    }

    let programData;
    try {
      const jsonMatch = programText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('Failed to parse program JSON:', e.message);
      return res.status(500).json({ error: 'Failed to parse generated program' });
    }

    const { data: program, error } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.weekly_focus
    }).select().single();

    if (error) {
      console.error('Program save error:', error.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const contextNote = programData.motivation_note || `Week ${week_no} program ready! Focus: ${programData.weekly_focus}`;

    await sendWhatsApp(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        String(week_no),
        contextNote
      ]
    });

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({
      success: true,
      program_id: program.id,
      week_no
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
