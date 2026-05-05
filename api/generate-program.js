const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./_lib/supabase');
const { sendText, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 800', 'below 1000', 'starvation',
  'clenbuterol', 'dnp', 'ephedrine', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in', 'crash diet'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const checkinSummary = (recentCheckins || []).map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues
    }));

    const anthropic = new Anthropic();
    const prompt = `You are a NASM-certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${week_no} of 12
- Started: ${client.program_started_at}

RECENT CHECK-INS:
${JSON.stringify(checkinSummary, null, 2)}

PREVIOUS PROGRAM:
${prevPrograms?.[0] ? JSON.stringify({ workout: prevPrograms[0].workout_plan, nutrition: prevPrograms[0].nutrition_plan }, null, 2) : 'None (first week)'}

Generate a complete Week ${week_no} program. Return ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          {"name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": ""}
        ],
        "cardio": "20 min LISS",
        "duration_min": 60
      }
    ],
    "rest_days": ["Sunday"],
    "notes": ""
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      {"meal": "Breakfast", "time": "7:00 AM", "options": ["Option 1", "Option 2"]},
      {"meal": "Lunch", "time": "12:30 PM", "options": ["Option 1", "Option 2"]},
      {"meal": "Dinner", "time": "7:00 PM", "options": ["Option 1", "Option 2"]},
      {"meal": "Snacks", "time": "Flexible", "options": ["Option 1"]}
    ],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein", "Creatine 5g"],
    "notes": ""
  },
  "coach_note": "A one-liner motivational/contextual note for the client"
}

Rules:
- Progressive overload from previous week where applicable
- Adjust calories/macros based on check-in trends
- If compliance was low, simplify the plan
- If energy was low, reduce volume slightly
- Never recommend below 1200 calories for women or 1500 for men
- Never recommend banned substances
- Keep it science-backed and sustainable`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    if (hasSafetyIssue(content)) {
      await notifyMaddy(
        'Program flagged for review',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nReason: Safety flag triggered in generated content`
      );
      return res.status(200).json({
        success: false,
        reason: 'Flagged for Maddy review — safety concern detected'
      });
    }

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('Failed to parse program JSON:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse generated program' });
    }

    const { data: program, error } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        workout_plan: parsed.workout_plan,
        nutrition_plan: parsed.nutrition_plan,
        notes: parsed.coach_note || '',
        pdf_url: null
      })
      .select()
      .single();

    if (error) throw error;

    const coachNote = parsed.coach_note || `Your Week ${week_no} program is ready!`;
    await sendText(
      client.phone,
      `*Week ${week_no} Program Ready!*\n\n${coachNote}\n\nCalories: ${parsed.nutrition_plan?.calories || 'See plan'}\nProtein: ${parsed.nutrition_plan?.protein_g || 'See plan'}g\n\nFull plan details sent to your email. Let's crush this week!`
    );

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
