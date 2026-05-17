const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

const SYSTEM_PROMPT = `You are a world-class fitness program architect working for Fitness by Maddy, an elite online coaching brand. You create personalized weekly workout and nutrition plans.

RULES:
- Never recommend extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Never promise unrealistic timelines (more than 1kg/week loss)
- Always include rest days (minimum 1-2 per week)
- Progressive overload principles
- Account for client's equipment access, injuries, and preferences
- If client has medical conditions, keep recommendations conservative and note "consult physician"

OUTPUT FORMAT (JSON):
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [...] }
    ],
    "notes": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meal_framework": [...],
    "notes": "..."
  },
  "weekly_focus": "...",
  "adjustments_made": "..."
}`;

async function generateWithClaude(clientData, checkinHistory) {
  const userPrompt = `Generate Week ${clientData.week_no} program for this client:

CLIENT PROFILE:
- Name: ${clientData.name}
- Program: ${clientData.program}
- Intake data: ${JSON.stringify(clientData.intake_data || {})}

RECENT CHECK-INS (last 2 weeks):
${JSON.stringify(checkinHistory, null, 2)}

Based on their progress, compliance, and any issues reported, create an appropriate program for the upcoming week. If compliance is low, simplify. If energy is low, reduce volume. If they're progressing well, increase intensity slightly.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status}`);
  }

  const result = await response.json();
  const text = result.content[0].text;

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');

  return JSON.parse(jsonMatch[0]);
}

function validateProgram(program) {
  if (program.nutrition_plan?.calories < 1200) {
    return { valid: false, reason: 'Calories too low (< 1200)' };
  }
  if (!program.workout_plan?.days || program.workout_plan.days.length > 7) {
    return { valid: false, reason: 'Invalid workout days' };
  }
  return { valid: true };
}

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
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const clientData = { ...client, week_no };
    const program = await generateWithClaude(clientData, checkins || []);

    const validation = validateProgram(program);
    if (!validation.valid) {
      const { createEscalation } = require('./lib/escalation');
      await createEscalation({
        clientId: client_id,
        phone: client.phone,
        reason: `Program validation failed: ${validation.reason}`,
        triggerMessage: `Week ${week_no} generation blocked`
      });
      return res.status(422).json({ error: 'Program failed safety check', reason: validation.reason });
    }

    const { data: programRecord } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: program.workout_plan,
        nutrition_plan: program.nutrition_plan,
        notes: program.weekly_focus,
        generated_at: new Date().toISOString()
      })
      .select()
      .single();

    await sendWhatsApp(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        `Week ${week_no}`,
        program.weekly_focus || 'Stay consistent!'
      ]
    }, true);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', programRecord.id);

    return res.status(200).json({ success: true, program_id: programRecord.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
