const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

const SAFETY_FLAGS = [
  'less than 800 calories', 'under 800 cal', 'extreme cut',
  'clenbuterol', 'dnp', 'ephedrine', 'steroids', 'sarms',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .maybeSingle();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await db
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .maybeSingle();

    const anthropic = new Anthropic();
    const prompt = buildPrompt(client, recentCheckins || [], lastProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const fullText = JSON.stringify(parsed).toLowerCase();
    const flagged = SAFETY_FLAGS.some(f => fullText.includes(f));
    if (flagged) {
      const { createEscalation } = require('../lib/escalation');
      await createEscalation(
        client.phone,
        'unsafe_program_content',
        `Week ${week_no} program flagged for safety review`,
        client.id
      );
      return res.json({ ok: false, flagged: true, message: 'Program flagged for Maddy review' });
    }

    const { data: program, error } = await db.from('programs').upsert({
      client_id,
      week_no,
      workout_plan: parsed.workout_plan || parsed.workout || {},
      nutrition_plan: parsed.nutrition_plan || parsed.nutrition || {},
      notes: parsed.notes || parsed.coach_note || '',
      generated_at: new Date().toISOString()
    }, { onConflict: 'client_id,week_no' }).select().single();

    if (error) throw error;

    const coachNote = parsed.notes || parsed.coach_note || `Week ${week_no} program ready!`;

    await sendTemplate(client.phone, 'weekly_program', {
      isClient: true,
      name: client.name,
      templateParams: [
        client.name || 'there',
        String(week_no),
        coachNote.slice(0, 200)
      ]
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.json({ ok: true, program_id: program.id, week_no });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, lastProgram, weekNo) {
  const checkinSummary = checkins.map(c => [
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm,`,
    `compliance=${c.compliance_score}/10, energy=${c.energy}/10`,
    c.issues ? `issues: ${c.issues}` : ''
  ].filter(Boolean).join(' ')).join('\n');

  return `You are an expert fitness coach creating a personalised weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${client.age || 'unknown'}
- Goal: ${client.goal || 'general fitness'}
- Injuries/limitations: ${client.injuries || 'none reported'}
- Diet preference: ${client.diet_pref || 'no restrictions'}
- Schedule: ${client.schedule || 'flexible'}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

${lastProgram ? `LAST WEEK'S PROGRAM NOTES: ${lastProgram.notes || 'none'}` : ''}

Generate Week ${weekNo} program. Return ONLY valid JSON:

{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min light cardio + dynamic stretches",
        "cooldown": "5 min stretching"
      }
    ],
    "rest_days": ["Wednesday", "Sunday"],
    "cardio": { "frequency": "3x/week", "type": "LISS or HIIT", "duration": "20-30min" }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meal_timing": ["Breakfast 8am", "Lunch 1pm", "Snack 4pm", "Dinner 7pm"],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein", "Creatine 5g"],
    "notes": "Adjust portions based on energy levels"
  },
  "notes": "One-liner coaching note for the client"
}

RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- No banned substances
- Account for any injuries mentioned
- Progressive overload from last week if data available
- Keep it realistic and sustainable`;
}
