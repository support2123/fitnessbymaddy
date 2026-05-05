const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./lib/supabase');
const { sendTemplate, maskPhone } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalation');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000 calories', 'under 800',
  'banned substance', 'steroid', 'dnp', 'clenbuterol', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in', 'crash diet',
  'starvation', 'water fast for'
];

function checkSafety(text) {
  const lower = text.toLowerCase();
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
      .select('*, intake:intake_submissions(*)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

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

    const intake = client.intake?.[0] || {};

    const prompt = `You are an expert fitness coach creating a weekly training and nutrition program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}
- Goal: ${intake.goal || 'general fitness'}
- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Height: ${intake.height_cm || 'unknown'}cm
- Current Weight: ${recentCheckins?.[0]?.weight || intake.weight_kg || 'unknown'}kg
- Injuries: ${intake.injuries || 'none reported'}
- Medical Conditions: ${intake.medical_conditions || 'none reported'}
- Diet Preference: ${intake.diet_preference || 'no preference'}
- Training Days/Week: ${intake.training_days || 5}
- Training Location: ${intake.training_location || 'gym'}

RECENT CHECK-INS:
${recentCheckins?.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n') || 'No previous check-ins'}

PREVIOUS WEEK PLAN SUMMARY:
${lastProgram ? JSON.stringify(lastProgram.workout_plan)?.substring(0, 500) : 'First week — no previous plan'}

RULES:
- Create a progressive, science-based plan
- Never prescribe banned substances or extreme calorie restrictions (minimum 1200 cal for women, 1500 for men)
- Adjust based on compliance and energy scores
- If injuries exist, provide modifications
- Be warm but professional in tone

Return ONLY valid JSON with this exact structure:
{
  "workout_plan": {
    "overview": "brief week overview",
    "days": [
      {"day": "Monday", "focus": "muscle group", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": ""}]},
      ...
    ],
    "cardio": "cardio recommendation"
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meal_timing": ["meal 1 details", "meal 2 details", ...],
    "hydration": "water recommendation",
    "supplements": ["only basic supplements"]
  },
  "notes": "key focus areas for this week"
}`;

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const rawText = response.content[0].text;

    if (checkSafety(rawText)) {
      await escalateToMaddy(
        'Program safety flag',
        `Client: ${client.name} (${maskPhone(client.phone)}), Week ${week_no} — AI output flagged for review`
      );
      return res.status(200).json({ ok: false, flagged: true, reason: 'Safety review required' });
    }

    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('Failed to parse AI response:', e.message);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const { data: programRecord, error } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        workout_plan: parsed.workout_plan,
        nutrition_plan: parsed.nutrition_plan,
        notes: parsed.notes
      })
      .select()
      .single();

    if (error) {
      console.error('Program save error:', error.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const contextNote = parsed.workout_plan?.overview || `Week ${week_no} program ready`;
    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `${week_no}`,
      contextNote.substring(0, 100)
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', programRecord.id);

    return res.status(200).json({
      ok: true,
      program_id: programRecord.id,
      week_no: parseInt(week_no)
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
