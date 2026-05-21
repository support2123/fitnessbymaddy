const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { sendText, notifyMaddy } = require('../lib/whatsapp');
const { handleCors } = require('../lib/helpers');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await supabase
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const checkinSummary = (recentCheckins || []).map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues
    }));

    const prompt = `You are an elite fitness program architect for FitnessByMaddy.

Generate a Week ${week_no} program for this client:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}

Recent check-in data:
${JSON.stringify(checkinSummary, null, 2)}

${lastProgram ? `Last week's focus: ${lastProgram.notes || 'General progression'}` : 'This is the first generated week.'}

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "split": "push/pull/legs or upper/lower or full body",
    "days": [
      {
        "day": "Monday",
        "focus": "Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"] }
    ],
    "supplements": ["Creatine 5g", "Vitamin D 2000IU"]
  },
  "notes": "One-liner context for this week's focus"
}

Rules:
- Never recommend below 1200 calories for women or 1500 for men
- Never recommend banned substances or steroids
- Keep timelines realistic (0.5-1kg/week fat loss max)
- Adjust based on compliance and energy scores from check-ins
- If compliance is low, simplify the plan rather than intensify`;

    const anthropic = new Anthropic();
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0].text;

    if (hasSafetyIssue(responseText)) {
      await notifyMaddy('SAFETY FLAG in generated program',
        `Client: ${client.name || client_id}\nWeek: ${week_no}\nReview required before sending.`
      );
      return res.status(200).json({ ok: false, reason: 'safety_flag', needs_review: true });
    }

    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch (e) {
      console.error('Failed to parse program JSON:', e.message);
      return res.status(500).json({ error: 'Failed to parse generated program' });
    }

    const { error } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: parsed.workout_plan || null,
      nutrition_plan: parsed.nutrition_plan || null,
      notes: parsed.notes || null
    });

    if (error) {
      return res.status(500).json({ error: 'Failed to save program' });
    }

    await sendText(client.phone,
      `Your Week ${week_no} program is ready! ${parsed.notes || 'Let\'s keep pushing!'}\n\nCheck your program folder for the detailed plan.`
    );

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, week_no });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
