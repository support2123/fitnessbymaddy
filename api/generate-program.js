const { getSupabase } = require('./lib/supabase');
const { sendTemplate, notifyMaddy } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'under 800',
  'banned substance', 'steroid', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'crash diet', 'water fast'
];

function checkSafety(text) {
  const lower = (text || '').toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
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

    const { data: existingProgram } = await db
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .limit(1);

    if (existingProgram && existingProgram.length > 0) {
      return res.status(409).json({ error: 'Program already generated for this week' });
    }

    let intakeData = {};
    try {
      const { data: lead } = await db
        .from('leads')
        .select('first_msg')
        .eq('id', client.lead_id)
        .single();
      if (lead?.first_msg) intakeData = JSON.parse(lead.first_msg);
    } catch {}

    const prompt = buildPrompt(client, intakeData, recentCheckins || [], week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content?.[0]?.text || '';

    const safetyFlag = checkSafety(responseText);
    if (safetyFlag) {
      await notifyMaddy(
        `SAFETY HALT: Program for ${maskPhone(client.phone)}`,
        `Week ${week_no} program flagged: "${safetyFlag}"\nProgram NOT sent. Manual review needed.`
      );
      return res.status(200).json({ halted: true, reason: safetyFlag });
    }

    let workout_plan = {};
    let nutrition_plan = {};
    let notes = '';

    try {
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        workout_plan = parsed.workout_plan || parsed.workouts || {};
        nutrition_plan = parsed.nutrition_plan || parsed.nutrition || {};
        notes = parsed.notes || parsed.coach_note || '';
      }
    } catch {
      notes = responseText.slice(0, 500);
    }

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan,
      nutrition_plan,
      notes,
      pdf_url: null
    }).select().single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      notes.slice(0, 200) || 'Your new program is ready!'
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  return `You are a certified fitness coach creating a personalised weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Goal: ${intake.goal || 'general fitness'}
- Injuries/limitations: ${intake.injuries || 'none reported'}
- Diet preference: ${intake.diet_pref || 'flexible'}
- Experience level: ${intake.experience_level || 'intermediate'}
- Current weight: ${intake.current_weight || 'unknown'}
- Target weight: ${intake.target_weight || 'unknown'}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

GENERATE Week ${weekNo} program as JSON:
\`\`\`json
{
  "workout_plan": {
    "day_1": { "name": "...", "exercises": [{"name":"...","sets":3,"reps":"8-12","rest":"60s","notes":"..."}] },
    ...up to day_6, day_7 is rest
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_plan": [
      {"meal":"Breakfast","description":"...","calories":0},
      ...
    ],
    "hydration": "...",
    "supplements": "..."
  },
  "coach_note": "One paragraph personalised note about this week's focus"
}
\`\`\`

RULES:
- Be scientifically accurate and safe
- Never recommend below 1200 calories for women or 1500 for men
- Never recommend banned substances
- Adapt based on check-in data (fatigue → deload, high compliance → progress)
- Include warm-up and cooldown notes
- Keep it practical for ${client.program === '6wk_home' ? 'home with minimal equipment' : 'gym setting'}`;
}
