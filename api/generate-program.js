const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { notifyMaddy } = require('../lib/whatsapp');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'steroids', 'anabolic',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const prompt = buildPrompt(client, recentCheckins || [], prevPrograms || [], week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
    let programData;
    try {
      programData = JSON.parse(jsonMatch ? jsonMatch[1] : content);
    } catch {
      programData = { workout_plan: { raw: content }, nutrition_plan: {} };
    }

    const outputStr = JSON.stringify(programData).toLowerCase();
    const hasSafetyIssue = SAFETY_FLAGS.some(flag => outputStr.includes(flag));

    if (hasSafetyIssue) {
      await notifyMaddy(
        'Safety flag in generated program',
        `Client ${client.name || client.phone} Week ${week_no} — review before sending`
      );
      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan || {},
        nutrition_plan: programData.nutrition_plan || {},
        notes: 'FLAGGED FOR REVIEW — safety concern detected'
      });
      return res.status(200).json({ success: true, flagged: true });
    }

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan || {},
      nutrition_plan: programData.nutrition_plan || {},
      notes: programData.notes || null
    }).select('id').single();

    const contextNote = buildContextNote(client, recentCheckins, week_no);

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      params: [client.name || 'there', String(week_no), contextNote]
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, prevPrograms, weekNo) {
  const lastCheckin = checkins[0];
  const prevPlan = prevPrograms[0];

  return `You are a world-class fitness coach creating a personalized weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${client.age || 'Not provided'}
- Goal: ${client.goal || 'General fitness'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}

WEEK ${weekNo} OF PROGRAM

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None'}
- Focus: ${lastCheckin.next_week_focus || 'None set'}` : 'No previous check-in data available.'}

${prevPlan ? `PREVIOUS WEEK'S PLAN SUMMARY:
${JSON.stringify(prevPlan.workout_plan || {}).slice(0, 500)}` : ''}

Generate a complete weekly program as JSON with this structure:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "20 min LISS"
      }
    ],
    "deload_notes": ""
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fat_g": 70,
    "meal_timing": "4 meals, pre/post workout nutrition",
    "hydration": "3L water daily",
    "supplements": ["Whey protein", "Creatine 5g"],
    "sample_meals": [
      { "meal": "Breakfast", "description": "Oats with whey, banana, almonds" }
    ]
  },
  "notes": "One-liner coaching note for the week"
}
\`\`\`

RULES:
- Be specific with exercises, sets, reps, and rest periods
- Adjust intensity based on compliance and energy scores
- If compliance < 6, simplify the plan
- If energy < 5, reduce volume by 15-20%
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Include progressive overload from the previous week when available
- Keep the coaching note warm, motivating, and under 2 sentences`;
}

function buildContextNote(client, checkins, weekNo) {
  if (!checkins || checkins.length === 0) {
    return `Week ${weekNo} program is ready! Let's crush it 💪`;
  }
  const last = checkins[0];
  if (last.compliance_score >= 8) {
    return `Amazing consistency last week! Week ${weekNo} builds on that momentum 🔥`;
  }
  if (last.compliance_score <= 5) {
    return `Fresh start this week — simplified plan to help you build back up 💪`;
  }
  return `Week ${weekNo} is here — progressive adjustments based on your check-in 📈`;
}
