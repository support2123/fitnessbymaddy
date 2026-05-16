const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'anavar', 'steroid',
  'lose 10kg in 1 week', 'crash diet'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
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

    const intake = client.intake_data || {};
    const lastCheckin = checkins?.[0] || null;
    const prevCheckin = checkins?.[1] || null;

    const systemPrompt = `You are a NASM-certified fitness program architect for Fitness by Maddy.
Generate a complete weekly training and nutrition plan. Output valid JSON only.

Rules:
- Programs must be safe, evidence-based, and appropriate for the client's level
- Never prescribe calories below 1200 for women or 1500 for men
- Never recommend banned substances or unrealistic timelines
- Adjust intensity based on compliance and energy scores from check-ins
- Include progressive overload principles
- Consider injuries/limitations from intake data`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Goal: ${intake.goal || 'general fitness'}
- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Injuries/Limitations: ${intake.injuries || 'none reported'}
- Diet Preference: ${intake.diet_pref || 'no preference'}
- Schedule: ${intake.schedule || 'flexible'}
- Medical: ${intake.medical_conditions || 'none'}

${lastCheckin ? `LAST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'not reported'}
- Waist: ${lastCheckin.waist || 'not reported'}
- Compliance: ${lastCheckin.compliance_score}/10
- Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'none'}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'not reported'}
- Compliance: ${prevCheckin.compliance_score}/10
- Energy: ${prevCheckin.energy}/10` : ''}

Output JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": ""}] },
      ...
    ],
    "rest_days": ["Sunday"],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_timing": ["..."],
    "sample_meals": [{"meal": "Breakfast", "options": ["..."]}],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "Brief coaching note for the week",
  "next_week_focus": "What to focus on next"
}`;

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0].text;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No valid JSON in Claude response');
    }

    const program = JSON.parse(jsonMatch[0]);

    const outputStr = JSON.stringify(program).toLowerCase();
    for (const flag of SAFETY_FLAGS) {
      if (outputStr.includes(flag)) {
        await notifyMaddy(
          'Program safety flag',
          `Week ${week_no} for ${client.name || client_id} flagged: "${flag}". Review required.`
        );
        return res.status(200).json({ success: false, reason: 'safety_flag', flag });
      }
    }

    const { error: progErr } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      workout_plan: program.workout_plan,
      nutrition_plan: program.nutrition_plan,
      notes: program.notes
    });

    if (progErr) throw progErr;

    const contextNote = program.notes || `Week ${week_no} program ready!`;
    await sendWhatsApp(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [client.name || 'there', week_no.toString(), contextNote]
    });

    return res.status(200).json({ success: true, week_no });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
