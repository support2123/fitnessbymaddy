const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

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

    const { data: prevProgram } = await supabase
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy.
Generate a weekly training and nutrition plan based on the client data provided.

RULES:
- Never prescribe extreme calorie deficits (below 1200 cal for women, 1500 for men)
- Never recommend banned/dangerous supplements
- Never set unrealistic timelines (>1kg/week fat loss)
- Progressive overload principle
- Account for injuries and limitations
- Output valid JSON only

Output format:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": ""}] },
      ...
    ],
    "cardio": "...",
    "rest_days": ["Saturday", "Sunday"]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] },
      ...
    ],
    "supplements": ["..."],
    "hydration": "3L/day"
  },
  "notes": "Brief context note for the client"
}`;

    const userPrompt = `Client: ${client.name}
Program: ${client.program}
Week: ${week_no}

Recent check-ins: ${JSON.stringify(recentCheckins || [])}
Previous program: ${JSON.stringify(prevProgram?.[0]?.workout_plan || 'None - first week')}

Generate Week ${week_no} program. Adjust based on compliance, energy levels, and any issues reported.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;
    let programData;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('Failed to parse program JSON:', e.message);
      return res.status(500).json({ error: 'Failed to parse generated program' });
    }

    if (isSafeProgram(programData) === false) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy(
        'Generated program flagged for safety review',
        `Client: ${client.name}, Week ${week_no}. Calories or recommendations may be unsafe.`
      );
      return res.status(200).json({ flagged: true, reason: 'Safety review required' });
    }

    const { data: program, error } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes || '',
    }).select().single();

    if (error) {
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const contextNote = programData.notes || `Week ${week_no} program is ready!`;
    await sendWhatsApp(client.phone, 'weekly_program', [contextNote]);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function isSafeProgram(data) {
  if (!data || !data.nutrition_plan) return true;
  const cals = data.nutrition_plan.calories;
  if (cals && cals < 1200) return false;
  const supps = data.nutrition_plan.supplements || [];
  const banned = ['dnp', 'clenbuterol', 'ephedrine', 'sarms', 'steroids'];
  for (const s of supps) {
    if (banned.some(b => s.toLowerCase().includes(b))) return false;
  }
  return true;
}
