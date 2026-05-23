const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { notifyMaddy } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000 cal', 'banned substance',
  'steroid', 'dnp', 'clenbuterol', 'ephedra',
  'lose 10kg in 1 week', 'crash diet'
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
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
      .limit(1);

    if (!client || client.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: previousPrograms } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const prompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Generate Week ${week_no} training and nutrition plan for this client.

CLIENT PROFILE:
- Name: ${client[0].name || 'Client'}
- Program: ${client[0].program}
- Started: ${client[0].program_started_at}

RECENT CHECK-INS:
${JSON.stringify(recentCheckins || [], null, 2)}

PREVIOUS WEEK PLAN:
${JSON.stringify(previousPrograms?.[0] || 'First week', null, 2)}

OUTPUT FORMAT (respond ONLY with valid JSON):
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..."}] }
    ],
    "rest_days": ["Sunday"],
    "cardio": "..."
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_timing": "...",
    "notes": "...",
    "sample_meals": [{"meal": "Breakfast", "options": ["..."]}]
  },
  "weekly_focus": "...",
  "coach_note": "..."
}

RULES:
- Progressive overload from previous week
- Adjust based on compliance score and energy
- If issues mentioned, modify accordingly
- Never prescribe below 1200 cal for women or 1500 for men
- No banned substances or extreme protocols
- Keep it evidence-based and sustainable`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    if (hasSafetyIssue(content)) {
      await notifyMaddy(`SAFETY FLAG: Program for client ${client[0].name || client_id} week ${week_no} needs review.`);
      return res.status(200).json({ flagged: true, message: 'Flagged for manual review' });
    }

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    const { error } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.coach_note || parsed.weekly_focus || null,
      pdf_url: null
    });

    if (error) throw error;

    const note = parsed.weekly_focus || `Week ${week_no} plan ready!`;
    await sendWhatsApp({
      phone: client[0].phone,
      templateName: 'weekly_program',
      body: `💪 Week ${week_no} Plan Ready!\n\n${note}\n\nFull plan sent to your profile. Questions? Just reply here.`,
      params: [String(week_no), note]
    });

    return res.status(200).json({ success: true, week_no });
  } catch (err) {
    console.error('Program gen error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
