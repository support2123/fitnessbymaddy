const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./_lib/supabase');
const { sendWhatsAppUnlimited } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800', 'extreme deficit',
  'clenbuterol', 'dnp', 'steroid', 'sarm', 'ephedrine',
  'lose 10kg in 1 week', '20 pounds in a week'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
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
      .single();

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
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const prompt = buildProgramPrompt(client, recentCheckins || [], lastProgram, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const programText = response.content[0].text;

    if (hasSafetyIssue(programText)) {
      await escalateToMaddy({
        reason: 'Program flagged for safety review',
        phone: client.phone,
        clientName: client.name,
        details: `Week ${week_no} program contained flagged content. Review before sending.`
      });

      return res.status(200).json({
        action: 'flagged_for_review',
        client_id,
        week_no
      });
    }

    let workoutPlan, nutritionPlan;
    try {
      const parsed = JSON.parse(programText);
      workoutPlan = parsed.workout_plan || parsed.workout || {};
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition || {};
    } catch {
      workoutPlan = { raw: programText };
      nutritionPlan = {};
    }

    const { data: program } = await supabase
      .from('programs')
      .upsert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        workout_plan: workoutPlan,
        nutrition_plan: nutritionPlan,
        notes: `Auto-generated for week ${week_no}`
      }, {
        onConflict: 'client_id,week_no'
      })
      .select()
      .single();

    await sendWhatsAppUnlimited({
      phone: client.phone,
      templateName: 'weekly_program',
      params: [
        client.name || 'there',
        `${week_no}`,
        `Week ${week_no} program is ready! Check your plan and let's crush it.`
      ]
    });

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({
      action: 'program_generated',
      program_id: program.id,
      week_no
    });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildProgramPrompt(client, checkins, lastProgram, weekNo) {
  const latestCheckin = checkins[0] || {};
  const previousCheckin = checkins[1] || {};

  return `You are a certified personal trainer and nutrition coach creating a weekly program.
Return ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {"day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..."}]}
    ],
    "rest_days": ["Sunday"],
    "cardio": {"type": "...", "duration": "...", "frequency": "..."}
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 65,
    "meal_timing": [{"meal": "Breakfast", "time": "8am", "example": "..."}],
    "supplements": ["..."],
    "hydration": "..."
  },
  "weekly_focus": "...",
  "motivation_note": "..."
}

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}

LATEST CHECK-IN (Week ${latestCheckin.week_no || 'N/A'}):
- Weight: ${latestCheckin.weight || 'N/A'}
- Waist: ${latestCheckin.waist || 'N/A'}
- Compliance: ${latestCheckin.compliance_score || 'N/A'}/10
- Energy: ${latestCheckin.energy || 'N/A'}/10
- Issues: ${latestCheckin.issues || 'None reported'}

PREVIOUS CHECK-IN (Week ${previousCheckin.week_no || 'N/A'}):
- Weight: ${previousCheckin.weight || 'N/A'}
- Compliance: ${previousCheckin.compliance_score || 'N/A'}/10

${lastProgram ? `LAST WEEK FOCUS: ${lastProgram.notes || 'General training'}` : 'This is the first week.'}

RULES:
- Be progressive: increase volume or intensity from last week if compliance was high
- If compliance was low, simplify and reduce volume
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme measures
- Include warm-up and cool-down notes
- Keep it practical and achievable`;
}

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}
