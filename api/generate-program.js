const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000', 'under 800',
  'banned substance', 'steroid', 'dnp', 'clenbuterol',
  'lose 10kg in 1 week', 'crash diet'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lead } = client.lead_id
      ? await supabase.from('leads').select('intake_data').eq('id', client.lead_id).single()
      : { data: null };

    const prompt = buildPrompt(client, checkins || [], lead?.intake_data, week_no);

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
    const programText = claudeData.content?.[0]?.text || '';

    const lowerProgram = programText.toLowerCase();
    const isFlagged = SAFETY_FLAGS.some(flag => lowerProgram.includes(flag));
    if (isFlagged) {
      const { escalateToMaddy } = require('./lib/escalation');
      await escalateToMaddy('Program flagged for safety review', {
        phone: client.phone,
        message: `Week ${week_no} program for ${client.name} flagged`
      });
      return res.status(200).json({ success: false, reason: 'flagged_for_review' });
    }

    let workoutPlan, nutritionPlan;
    try {
      const parsed = JSON.parse(programText);
      workoutPlan = parsed.workout_plan || parsed.workouts || {};
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition || {};
    } catch {
      workoutPlan = { raw: programText };
      nutritionPlan = {};
    }

    const pdfUrl = `https://${process.env.SUPABASE_URL?.replace('https://', '')}/storage/v1/object/public/programs/clients/${client_id}/week_${week_no}.json`;

    await supabase.storage
      .from('programs')
      .upload(
        `clients/${client_id}/week_${week_no}.json`,
        JSON.stringify({ workout_plan: workoutPlan, nutrition_plan: nutritionPlan }),
        { contentType: 'application/json', upsert: true }
      );

    await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes: `Auto-generated for week ${week_no}`
    });

    await sendWhatsApp(client.phone, 'weekly_program', {
      name: client.name,
      templateParams: [client.name, `${week_no}`, pdfUrl]
    }, true);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no));

    return res.status(200).json({ success: true, week_no });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, intakeData, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a certified personal trainer and nutrition coach creating a weekly program.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Week: ${weekNo} of 12
- Started: ${client.program_started_at}
${intakeData ? `- Age: ${intakeData.age}, Gender: ${intakeData.gender}
- Height: ${intakeData.height}, Starting Weight: ${intakeData.weight}
- Goal: ${intakeData.goal}
- Injuries/Limitations: ${intakeData.injuries || 'None'}
- Diet Preference: ${intakeData.diet_pref || 'No restrictions'}
- Schedule: ${intakeData.schedule || '5 days/week'}
- Experience: ${intakeData.experience_level || 'Intermediate'}` : ''}

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight}kg, Waist: ${lastCheckin.waist}cm
- Compliance: ${lastCheckin.compliance_score}/10, Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'None'}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight}kg, Waist: ${prevCheckin.waist}cm
- Compliance: ${prevCheckin.compliance_score}/10, Energy: ${prevCheckin.energy}/10` : ''}

Generate a JSON object with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..."}] }
    ],
    "rest_days": ["Sunday"],
    "progression_note": "..."
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 150,
    "carbs_g": 220,
    "fats_g": 70,
    "meal_timing": ["..."],
    "focus_foods": ["..."],
    "avoid": ["..."],
    "hydration_liters": 3,
    "supplements": ["..."]
  },
  "coach_note": "Brief motivational note for the client"
}

RULES:
- Never recommend extreme calorie deficits (below 1200 for women, 1500 for men)
- Never recommend banned substances
- Adjust intensity based on compliance and energy scores
- If injuries reported, modify exercises to avoid aggravation
- Keep it realistic and sustainable`;
}
