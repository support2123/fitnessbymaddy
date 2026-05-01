const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'extreme deficit',
  'clenbuterol', 'dnp', 'sarms', 'steroids', 'ephedrine',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
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
      .select('*, lead:lead_id(*)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await db
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const prompt = buildProgramPrompt(client, intake, recentCheckins, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const programText = response.content[0].text;

    if (hasSafetyIssue(programText)) {
      const { escalateToMaddy } = require('./lib/escalation');
      await escalateToMaddy('Safety flag in generated program', {
        phone: client.phone,
        name: client.name,
        message: `Week ${week_no} program flagged for safety review`
      });
      return res.json({ success: false, reason: 'safety_review', week_no });
    }

    let workoutPlan, nutritionPlan;
    try {
      const parsed = JSON.parse(programText);
      workoutPlan = parsed.workout_plan || parsed.workout;
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition;
    } catch {
      workoutPlan = { raw: programText };
      nutritionPlan = {};
    }

    const pdfContent = generatePdfText(client, week_no, workoutPlan, nutritionPlan);
    const pdfBlob = new Blob([pdfContent], { type: 'text/plain' });
    const pdfPath = `clients/${client_id}/week_${week_no}.txt`;

    await db.storage.from('programs').upload(pdfPath, pdfBlob, { upsert: true });

    const { data: urlData } = db.storage.from('programs').getPublicUrl(pdfPath);

    const { data: program } = await db.from('programs').upsert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      pdf_url: urlData?.publicUrl || pdfPath,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes: `Generated for week ${week_no}`
    }, { onConflict: 'client_id,week_no' }).select().single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      week_no.toString(),
      urlData?.publicUrl || 'Check your program folder'
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.json({ success: true, program_id: program.id, week_no });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, intake, checkins, weekNo) {
  const profile = intake ? `
CLIENT PROFILE:
- Age: ${intake.age || 'N/A'}, Gender: ${intake.gender || 'N/A'}
- Height: ${intake.height_cm || 'N/A'}cm, Current Weight: ${intake.current_weight || 'N/A'}kg
- Goal Weight: ${intake.goal_weight || 'N/A'}kg, Goal: ${intake.goal || 'General fitness'}
- Injuries: ${intake.injuries || 'None reported'}
- Medical: ${intake.medical_conditions || 'None'}
- Diet Preference: ${intake.diet_preference || 'No preference'}
- Experience: ${intake.training_experience || 'N/A'}
- Available Days: ${intake.available_days || 5}/week
- Equipment: ${intake.equipment_access || 'Full gym'}` : 'No intake data available.';

  const checkinHistory = (checkins || []).map(c =>
    `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues: ${c.issues || 'None'}`
  ).join('\n');

  return `You are a certified personal trainer and nutrition coach creating a weekly program.

${profile}

PROGRAM: ${client.program} (${client.name})
WEEK: ${weekNo}

${checkinHistory ? `RECENT CHECK-INS:\n${checkinHistory}` : 'First week — no check-in history.'}

Create a detailed weekly program. Respond with valid JSON only:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "15 min incline walk"
      }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fats_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["Option A description", "Option B description"] }
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3-4 liters water daily"
  },
  "weekly_focus": "Progressive overload on compound lifts, maintain calorie deficit",
  "adjustments_from_checkin": "Based on check-in data, adjusted..."
}

RULES:
- Never suggest calories below 1200 for women or 1500 for men
- No banned substances or unrealistic timelines
- Adjust based on check-in compliance and energy levels
- Include rest days appropriate to experience level
- Be specific with exercise names, sets, reps, and rest periods`;
}

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

function generatePdfText(client, weekNo, workout, nutrition) {
  const lines = [
    '═══════════════════════════════════════════════',
    `FITNESS BY MADDY — Week ${weekNo} Program`,
    `Client: ${client.name || 'N/A'}`,
    `Program: ${client.program}`,
    `Generated: ${new Date().toLocaleDateString('en-IN')}`,
    '═══════════════════════════════════════════════',
    '',
    'WORKOUT PLAN',
    '─────────────────────────────',
    JSON.stringify(workout, null, 2),
    '',
    'NUTRITION PLAN',
    '─────────────────────────────',
    JSON.stringify(nutrition, null, 2),
    '',
    '═══════════════════════════════════════════════',
    'www.fitnessbymaddy.com | @fitnessbymaddy_',
    '═══════════════════════════════════════════════'
  ];
  return lines.join('\n');
}
