const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000 cal', 'starvation',
  'banned substance', 'steroid', 'clenbuterol', 'dnp',
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
      return res.status(400).json({ error: 'Missing client_id or week_no' });
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

    const checkinContext = recentCheckins && recentCheckins.length > 0
      ? recentCheckins.map(c =>
        `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
      ).join('\n')
      : 'No previous check-ins available (Week 1).';

    const prompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.

Generate a Week ${week_no} program for this client:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}

Recent check-in data:
${checkinContext}

Generate a complete weekly program as JSON with this exact structure:
{
  "workout_plan": {
    "overview": "Brief weekly focus",
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "20min LISS post-workout"
      }
    ],
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "daily_calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 65,
    "meal_timing": ["7am breakfast", "10am snack", "1pm lunch", "4pm pre-workout", "7pm dinner"],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein", "Creatine 5g", "Fish oil"],
    "notes": "Adjust portions based on energy levels"
  },
  "coach_notes": "Brief personalized note for the client"
}

RULES:
- Be evidence-based and safe. No extreme calorie deficits below 1200 for women or 1500 for men.
- No banned substances. No unrealistic timelines.
- Progressive overload from previous weeks if check-in data is available.
- Adjust based on compliance score and energy levels.
- If the client reported issues, address them specifically.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = response.content[0].text;

    if (hasSafetyIssue(responseText)) {
      const { sendTemplate: escalate } = require('../lib/whatsapp');
      const { maskPhone } = require('../lib/whatsapp');
      await escalate(process.env.MADDY_PHONE || '917082478374', 'escalation_alert', [
        'Unsafe program flagged',
        maskPhone(client.phone),
        `Week ${week_no} program had safety flags`
      ]);
      return res.status(200).json({ flagged: true, reason: 'Safety review needed' });
    }

    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      programData = null;
    }

    if (!programData) {
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const { data: program, error } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_notes || '',
      generated_at: new Date().toISOString()
    }).select().single();

    if (error) throw error;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      programData.coach_notes || 'Your new program is ready!'
    ]);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });

  } catch (err) {
    console.error('[generate-program]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
