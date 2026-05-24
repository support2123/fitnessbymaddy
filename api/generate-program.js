const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { corsHeaders } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalation');

const SAFETY_KEYWORDS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'dnp', 'clenbuterol', 'steroid', 'sarm', 'ephedra',
  'lose 10kg in 1 week', 'crash diet',
];

function checkProgramSafety(text) {
  const lower = text.toLowerCase();
  return SAFETY_KEYWORDS.some(kw => lower.includes(kw));
}

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    const { data: prevPrograms } = await db
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    let intakeData = {};
    if (client.folder_url && client.folder_url.startsWith('{')) {
      try { intakeData = JSON.parse(client.folder_url); } catch {}
    }

    const prompt = buildProgramPrompt(client, intakeData, recentCheckins || [], prevPrograms || [], week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    const generatedText = claudeData.content?.[0]?.text || '';

    if (checkProgramSafety(generatedText)) {
      await escalateToMaddy('Program flagged — safety concern', {
        phone: client.phone,
        summary: `Week ${week_no} program for ${client.name || maskPhone(client.phone)} flagged for safety review`,
      });
      return res.status(200).json({ action: 'flagged_for_review' });
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const jsonMatch = generatedText.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        workoutPlan = parsed.workout_plan || parsed.workout;
        nutritionPlan = parsed.nutrition_plan || parsed.nutrition;
        notes = parsed.notes || parsed.coach_notes || '';
      } else {
        workoutPlan = { raw: generatedText };
        nutritionPlan = {};
        notes = '';
      }
    } catch {
      workoutPlan = { raw: generatedText };
      nutritionPlan = {};
      notes = '';
    }

    const { data: program, error } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes,
    }).select().single();

    if (error) throw error;

    const contextNote = notes
      || `Week ${week_no} program ready — ${client.name || 'your'} customized plan is here!`;

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      contextNote.slice(0, 200),
    ]);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });

  } catch (err) {
    console.error('Program gen error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, intake, checkins, prevPrograms, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a NASM-certified fitness program architect for Fitness by Maddy.

Generate a Week ${weekNo} personalized program for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Goal: ${intake.goal || 'general fitness'}
- Injuries/limitations: ${intake.injuries || 'none reported'}
- Medical: ${intake.medical_conditions || 'none reported'}
- Diet preference: ${intake.diet_preference || 'no restriction'}
- Workout days/week: ${intake.workout_days || '4-5'}
- Gym access: ${intake.gym_access || 'yes'}

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'none'}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10` : ''}

${prevPrograms[0] ? `LAST WEEK'S FOCUS: ${prevPrograms[0].notes || 'standard progression'}` : ''}

RULES:
- Never prescribe extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned/dangerous supplements
- Keep timelines realistic
- If client reports pain or injury, modify exercises accordingly
- Progressive overload — build on previous weeks

OUTPUT FORMAT — respond ONLY with a JSON block:
\`\`\`json
{
  "workout_plan": {
    "days": [
      { "day": "Day 1", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]},
    ],
    "cardio": "3x per week, 20 min moderate intensity"
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fat_g": 70,
    "meal_timing": "4 meals, pre/post workout nutrition",
    "notes": "Focus on whole foods, increase water to 3L/day"
  },
  "notes": "One-liner coach note for WhatsApp message"
}
\`\`\``;
}
