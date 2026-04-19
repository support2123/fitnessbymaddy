const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./supabase');

const SAFETY_FLAGS = [
  'less than 1000 calories', 'under 800 cal', 'extreme cut',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in'
];

function hasSafetyIssue(text) {
  const lower = (typeof text === 'string' ? text : JSON.stringify(text)).toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }
  return null;
}

async function generateWeeklyProgram(clientId, weekNo) {
  const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const { data: clientData } = await supabase
    .from('clients')
    .select('*, leads(*)')
    .eq('id', clientId)
    .single();

  if (!clientData) throw new Error('Client not found');

  const { data: recentCheckins } = await supabase
    .from('checkins')
    .select('*')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: previousPrograms } = await supabase
    .from('programs')
    .select('week_no, workout_plan, nutrition_plan, notes')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(1);

  const systemPrompt = `You are Maddy's program architect for FitnessByMaddy. You design weekly workout and nutrition plans for online coaching clients.

RULES:
- Programs must be safe, evidence-based, and progressive
- Never prescribe less than 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Include proper warm-up and cool-down
- Nutrition should be practical and culturally appropriate (Indian diet preferences for IN market clients)
- Be specific: exact exercises, sets, reps, rest periods, and meal plans with portions
- Output valid JSON only`;

  const userPrompt = `Generate Week ${weekNo} program for this client:

CLIENT PROFILE:
- Name: ${clientData.name || 'Client'}
- Program: ${clientData.program}
- Market: ${clientData.leads?.market || 'GLOBAL'}
- Started: ${clientData.program_started_at}

${recentCheckins?.length > 0 ? `RECENT CHECK-INS:
${recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')}` : 'No previous check-ins yet (Week 1)'}

${previousPrograms?.length > 0 ? `PREVIOUS WEEK PROGRAM SUMMARY:
Week ${previousPrograms[0].week_no}: ${previousPrograms[0].notes || 'Standard program'}` : ''}

OUTPUT FORMAT (JSON):
{
  "workout_plan": {
    "overview": "Brief week overview",
    "days": [
      {
        "day": "Day 1 - Upper Body Push",
        "warmup": "5 min dynamic stretching",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cooldown": "5 min static stretching"
      }
    ],
    "cardio": "3x 20min LISS or 2x 15min HIIT",
    "rest_days": "Wednesday and Sunday"
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "macros": { "protein_g": 150, "carbs_g": 200, "fats_g": 67 },
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1 with portions", "Option 2 with portions"] }
    ],
    "supplements": ["Whey protein 1 scoop post-workout", "Creatine 5g daily"],
    "hydration": "3-4L water daily"
  },
  "notes": "Focus notes for the week"
}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });

  const content = response.content[0].text;

  let parsed;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
  } catch {
    throw new Error('Failed to parse program JSON from Claude response');
  }

  const safetyIssue = hasSafetyIssue(parsed);
  if (safetyIssue) {
    return {
      success: false,
      flagged: true,
      reason: safetyIssue,
      raw: parsed
    };
  }

  const { data: program, error } = await supabase
    .from('programs')
    .insert({
      client_id: clientId,
      week_no: weekNo,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.notes,
      generated_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw new Error(`DB insert failed: ${error.message}`);

  return { success: true, program };
}

module.exports = { generateWeeklyProgram, hasSafetyIssue };
