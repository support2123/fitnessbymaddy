const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./supabase');

const SAFETY_FLAGS = [
  /below\s*800\s*cal/i,
  /extreme\s*(cut|deficit|fast)/i,
  /steroid/i,
  /clenbuterol|dnp|ephedr/i,
  /lose\s*(10|15|20)\+?\s*kg\s*in\s*(1|2)\s*week/i,
];

async function generateWeeklyProgram(clientId, weekNo) {
  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single();

  if (!client) throw new Error(`Client ${clientId} not found`);

  const { data: recentCheckins } = await supabase
    .from('checkins')
    .select('*')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: lastProgram } = await supabase
    .from('programs')
    .select('workout_plan, nutrition_plan, notes')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(1);

  const prompt = buildPrompt(client, recentCheckins || [], lastProgram?.[0], weekNo);

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0].text;

  let parsed;
  try {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
  } catch {
    throw new Error('Failed to parse program JSON from Claude response');
  }

  const flagged = checkSafety(content);

  const { data: program, error } = await supabase
    .from('programs')
    .insert({
      client_id: clientId,
      week_no: weekNo,
      workout_plan: parsed.workout_plan || parsed.workouts,
      nutrition_plan: parsed.nutrition_plan || parsed.nutrition,
      notes: parsed.notes || '',
      flagged_for_review: flagged,
    })
    .select()
    .single();

  if (error) throw error;

  return { program, flagged };
}

function buildPrompt(client, checkins, lastProgram, weekNo) {
  const latestCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a certified fitness coach designing Week ${weekNo} of a personalized ${client.program} program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Age: ${client.age || 'Unknown'}
- Goal: ${client.goal || 'General fitness'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}
- Experience: ${client.experience_level || 'Beginner'}
- Program: ${client.program}

${latestCheckin ? `LATEST CHECK-IN (Week ${latestCheckin.week_no}):
- Weight: ${latestCheckin.weight || 'Not recorded'} kg
- Waist: ${latestCheckin.waist || 'Not recorded'} cm
- Compliance: ${latestCheckin.compliance_score}/10
- Energy: ${latestCheckin.energy}/10
- Issues: ${latestCheckin.issues || 'None'}
- Focus: ${latestCheckin.next_week_focus || 'Not specified'}` : 'No previous check-in data available.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Compliance: ${prevCheckin.compliance_score}/10` : ''}

${lastProgram ? `LAST WEEK'S PROGRAM SUMMARY:
${JSON.stringify(lastProgram, null, 2)}` : 'This is the first week of programming.'}

RULES:
- Design a safe, progressive program appropriate for the client's level
- Never prescribe calories below 1200 for women or 1500 for men
- No extreme deficits, banned substances, or unrealistic timelines
- Account for any injuries or limitations
- Include warm-up and cool-down in workout days
- Provide 5-6 training days with 1-2 rest days
- Nutrition should include macros and sample meal ideas

Return ONLY valid JSON in this format:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Exercise", "sets": 3, "reps": "10-12", "rest": "60s", "notes": "" }
        ],
        "warmup": "5 min cardio + dynamic stretches",
        "cooldown": "5 min static stretches"
      }
    ]
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 130,
    "carbs_g": 200,
    "fat_g": 60,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"] }
    ],
    "notes": ""
  },
  "notes": "Week ${weekNo} coaching notes for the client"
}
\`\`\``;
}

function checkSafety(content) {
  for (const pattern of SAFETY_FLAGS) {
    if (pattern.test(content)) return true;
  }
  return false;
}

module.exports = { generateWeeklyProgram };
