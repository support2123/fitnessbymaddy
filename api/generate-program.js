const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'sarms', 'steroids',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'very low calorie'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .maybeSingle();

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
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: intakeMsg } = await supabase
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .ilike('body', '%intake form%')
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let intakeData = {};
    if (intakeMsg && intakeMsg.body) {
      try {
        const jsonStr = intakeMsg.body.replace('[intake form] ', '');
        intakeData = JSON.parse(jsonStr);
      } catch (e) {}
    }

    const prompt = buildPrompt(client, intakeData, recentCheckins || [], lastProgram, week_no);

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    if (hasSafetyIssue(content)) {
      const { supabase: sb } = require('./_lib/supabase');
      await sb.from('escalations').insert({
        phone: client.phone,
        reason: 'unsafe_program_content',
        message_body: `Week ${week_no} program flagged for safety review`
      });
      console.error(`SAFETY FLAG: Program for ${maskPhone(client.phone)} week ${week_no}`);
      return res.status(200).json({ ok: false, flagged: true });
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const parsed = JSON.parse(content);
      workoutPlan = parsed.workout_plan || parsed.workout;
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition;
      notes = parsed.notes || parsed.coach_notes || '';
    } catch (e) {
      workoutPlan = { raw: content };
      nutritionPlan = {};
      notes = '';
    }

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: workoutPlan,
        nutrition_plan: nutritionPlan,
        notes,
        pdf_url: null
      })
      .select()
      .single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'Champion',
      `Week ${week_no}`,
      notes || 'Your updated program is ready!'
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);
    return res.status(200).json({ ok: true, program_id: program.id });
  } catch (err) {
    console.error('Program gen error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, intake, checkins, lastProgram, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  return `You are a world-class fitness program architect for Fitness by Maddy, an elite online coaching brand.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Goal: ${intake.goal || 'body transformation'}
- Injuries: ${intake.injuries || 'none reported'}
- Diet preference: ${intake.diet_pref || 'flexible'}
- Schedule: ${intake.schedule || '5 days/week'}
- Experience: ${intake.experience || 'intermediate'}
- Current weight: ${intake.current_weight || 'not provided'}
- Target weight: ${intake.target_weight || 'not provided'}
- Height: ${intake.height || 'not provided'}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

${lastProgram ? `LAST WEEK'S PROGRAM NOTES: ${lastProgram.notes || 'none'}` : ''}

GENERATE Week ${weekNo} program. Return ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "20 min LISS on incline treadmill"
      }
    ],
    "deload_notes": ""
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meal_framework": [
      { "meal": "Meal 1", "time": "8am", "description": "..." }
    ],
    "supplements": ["whey protein", "creatine 5g"],
    "hydration": "3-4L water daily"
  },
  "notes": "One sentence coach note for the WhatsApp message"
}

RULES:
- Never suggest calories below 1200 for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Progress based on check-in data: increase volume if compliance >7, reduce if <5
- If injuries mentioned, modify exercises and note alternatives
- Be specific with weights/reps progression from last week if data available
- Keep it science-backed, no bro-science`;
}
