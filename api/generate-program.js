const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglishMarket } = require('../lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000', 'under 800', 'starvation',
  'banned substance', 'steroid', 'sarm', 'dnp', 'clenbuterol',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'missing client_id or week_no' });
  }

  try {
    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'client not found' });

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

    const { data: existingProgram } = await db
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .limit(1);

    if (existingProgram && existingProgram.length > 0) {
      return res.status(409).json({ error: 'program already generated for this week' });
    }

    const prompt = buildPrompt(client, intake, recentCheckins, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const aiText = response.content[0].text;

    const safetyIssue = checkSafety(aiText);
    if (safetyIssue) {
      const { createEscalation } = require('../lib/escalation');
      await createEscalation(
        client.phone,
        `Program safety flag: ${safetyIssue}`,
        `Week ${week_no} generation flagged — halted for review`,
        client_id
      );
      return res.json({ action: 'flagged_for_review', reason: safetyIssue });
    }

    let parsed;
    try {
      const jsonMatch = aiText.match(/```json\s*([\s\S]*?)```/) || aiText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : aiText);
    } catch {
      parsed = { workout_plan: { raw: aiText }, nutrition_plan: { raw: aiText } };
    }

    const workoutPlan = parsed.workout_plan || parsed.workouts || {};
    const nutritionPlan = parsed.nutrition_plan || parsed.nutrition || {};
    const notes = parsed.notes || parsed.coach_notes || '';

    const pdfUrl = await generateProgramPDF(client_id, week_no, workoutPlan, nutritionPlan, notes);

    await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes,
    });

    const { data: lead } = await db
      .from('leads')
      .select('market')
      .eq('id', client.lead_id)
      .single();

    const market = lead?.market || 'GLOBAL';
    const templateName = isHinglishMarket(market) ? 'weekly_program_hi' : 'weekly_program_en';

    await sendWhatsApp(client.phone, templateName, [
      client.name || 'there',
      `${week_no}`,
    ], pdfUrl);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'generation failed' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const checkinSummary = (checkins || []).map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
  ).join('\n');

  return `You are a NASM-certified fitness program architect for Fitness by Maddy.

Generate a COMPLETE Week ${weekNo} program for this client. Output valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1",
        "name": "Upper Body Push",
        "focus": "Chest, shoulders, triceps",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein": 160,
    "carbs": 220,
    "fats": 73,
    "meals": [
      { "name": "Meal 1 - Breakfast", "description": "...", "options": ["Option A", "Option B"] }
    ]
  },
  "notes": "Coach notes for the week..."
}

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of 12
- Start date: ${client.program_started_at}

${intake ? `INTAKE DATA:
- Age: ${intake.age}
- Gender: ${intake.gender}
- Goal: ${intake.goal}
- Injuries: ${intake.injuries || 'None reported'}
- Diet: ${intake.diet_preference || 'No preference'}
- Schedule: ${intake.schedule || 'Flexible'}
- Medical: ${intake.medical_conditions || 'None'}
- Activity level: ${intake.current_activity || 'Not specified'}` : 'No intake data available.'}

${checkinSummary ? `RECENT CHECK-INS:\n${checkinSummary}` : 'No previous check-ins.'}

RULES:
- Progressive overload from previous weeks
- Minimum 1200 kcal/day for women, 1500 kcal/day for men
- Never recommend banned substances or extreme protocols
- Include rest days
- Adapt based on compliance and energy scores
- If injuries noted, provide modifications
- Be specific with exercise names, sets, reps, and rest periods`;
}

function checkSafety(text) {
  const lower = text.toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }
  const calorieMatch = lower.match(/(\d{3,4})\s*(?:kcal|calories|cal)/);
  if (calorieMatch && parseInt(calorieMatch[1]) < 1000) {
    return `dangerously low calories: ${calorieMatch[1]}`;
  }
  return null;
}
