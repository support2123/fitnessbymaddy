const Anthropic = require('anthropic');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, maskPhone } = require('./_lib/whatsapp');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'sarm', 'steroid',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const prompt = buildPrompt(client, recentCheckins || [], prevProgram, week_no);

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch {
      parsed = { raw: content, workout_plan: null, nutrition_plan: null };
    }

    const fullText = JSON.stringify(parsed).toLowerCase();
    const flagged = SAFETY_FLAGS.some((flag) => fullText.includes(flag));

    const { data: program, error } = await db
      .from('programs')
      .upsert(
        {
          client_id,
          week_no: parseInt(week_no),
          workout_plan: parsed.workout_plan || parsed.workouts || null,
          nutrition_plan: parsed.nutrition_plan || parsed.nutrition || null,
          notes: parsed.coach_note || parsed.notes || null,
          status: flagged ? 'flagged' : 'generated',
        },
        { onConflict: 'client_id,week_no' }
      )
      .select()
      .single();

    if (error) throw error;

    if (flagged) {
      const { sendTemplate: notifyMaddy } = require('./_lib/whatsapp');
      await notifyMaddy(
        process.env.MADDY_PHONE || '+917082478374',
        'program_flagged',
        [maskPhone(client.phone), String(week_no)]
      );
      return res.json({ success: true, status: 'flagged', program_id: program.id });
    }

    if (!flagged) {
      await sendTemplate(client.phone, 'weekly_program', [
        client.name || 'there',
        String(week_no),
      ]);

      await db
        .from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString(), status: 'sent' })
        .eq('id', program.id);
    }

    return res.json({ success: true, status: 'sent', program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, prevProgram, weekNo) {
  const profile = [
    `Client: ${client.name || 'Anonymous'}`,
    `Program: ${client.program}`,
    `Age: ${client.age || 'Unknown'}`,
    `Goal: ${client.goal || 'General fitness'}`,
    `Injuries/Limitations: ${client.injuries || 'None reported'}`,
    `Diet Preference: ${client.diet_pref || 'No preference'}`,
    `Schedule: ${client.schedule || 'Flexible'}`,
    `Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}`,
  ].join('\n');

  const checkinData = checkins.length
    ? checkins
        .map(
          (c) =>
            `Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, ` +
            `Compliance ${c.compliance_score || '?'}/10, Energy ${c.energy || '?'}/10` +
            (c.issues ? `, Issues: ${c.issues}` : '')
        )
        .join('\n')
    : 'No check-in data yet (Week 1).';

  const prevPlan = prevProgram
    ? `Previous week plan summary: ${JSON.stringify(prevProgram).slice(0, 500)}`
    : 'No previous plan (first week).';

  return `You are a NASM-certified fitness coach creating a weekly training and nutrition program.

CLIENT PROFILE:
${profile}

RECENT CHECK-IN DATA:
${checkinData}

${prevPlan}

Create a complete weekly program. Return ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          {"name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": ""}
        ],
        "cardio": "20 min incline walk"
      }
    ],
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meal_template": [
      {"meal": "Breakfast", "example": "4 eggs + 2 toast + fruit", "macros": "P30 C40 F15"}
    ],
    "hydration": "3L water daily",
    "supplements": ["Whey protein", "Creatine 5g"]
  },
  "coach_note": "Brief motivational note for the client"
}

RULES:
- Never suggest calories below 1200 for women or 1500 for men
- No banned substances, no extreme protocols
- Adapt based on check-in data (reduce volume if compliance/energy low)
- Be specific with exercises, sets, reps
- Keep nutrition realistic and culturally appropriate`;
}
