const Anthropic = require('@anthropic-ai/sdk').default;

async function generateProgram(clientData, checkinHistory) {
  const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const systemPrompt = `You are Maddy's AI program architect for FitnessByMaddy.
You design weekly workout and nutrition plans for online coaching clients.

RULES:
- Never prescribe extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned/controlled substances
- Never promise unrealistic timelines (e.g., "lose 10kg in 1 week")
- Programs must be safe, progressive, and evidence-based
- Always include rest days
- Account for any injuries or medical conditions mentioned
- Output valid JSON only`;

  const userPrompt = `Generate Week ${clientData.week_no} program for this client:

CLIENT PROFILE:
- Name: ${clientData.name}
- Program: ${clientData.program}
- Goal: ${clientData.goal || 'body recomposition'}
- Experience: ${clientData.experience || 'intermediate'}
- Injuries/conditions: ${clientData.injuries || 'none reported'}
- Diet preference: ${clientData.diet_preference || 'no preference'}

RECENT CHECK-IN DATA:
${JSON.stringify(checkinHistory, null, 2)}

Return JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "cardio": { "type": "", "frequency": "", "duration": "" }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["Option A", "Option B"] }
    ],
    "supplements": ["Whey protein post-workout", "Creatine 5g daily"],
    "hydration": "3-4L water daily"
  },
  "weekly_focus": "Progressive overload on compound movements",
  "notes": "Any personalized notes"
}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse program JSON from Claude response');

  const program = JSON.parse(jsonMatch[0]);

  const dangerous = detectDangerousContent(program);
  if (dangerous) {
    throw new Error(`SAFETY_HALT: ${dangerous}`);
  }

  return program;
}

function detectDangerousContent(program) {
  const np = program.nutrition_plan;
  if (np && np.calories && np.calories < 1200) {
    return 'Calorie target too low: ' + np.calories;
  }

  const banned = ['steroid', 'sarm', 'clenbuterol', 'dnp', 'ephedra', 'hgh'];
  const planStr = JSON.stringify(program).toLowerCase();
  for (const substance of banned) {
    if (planStr.includes(substance)) {
      return 'Banned substance detected: ' + substance;
    }
  }

  return null;
}

module.exports = { generateProgram };
