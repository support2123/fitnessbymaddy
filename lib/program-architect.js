const Anthropic = require('@anthropic-ai/sdk');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /\b(dnp|clenbuterol|sarms|anavar|tren|winstrol|dianabol)\b/i,
  /lose\s*\d{2,}\s*(kg|lb|pound).*week/i,
  /\b(starvation|water.?fast|dry.?fast)\b/i,
  /\b(extreme|crash)\s*diet/i
];

function detectRiskyContent(text) {
  const jsonStr = typeof text === 'string' ? text : JSON.stringify(text);
  return RISKY_PATTERNS.some(pattern => pattern.test(jsonStr));
}

async function generateWeeklyProgram(clientProfile, lastCheckins) {
  const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const checkinContext = lastCheckins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  const prompt = `You are a certified fitness program architect for FitnessByMaddy, an online coaching brand.
Generate a personalized weekly program based on this client data.

CLIENT PROFILE:
- Name: ${clientProfile.name}
- Program: ${clientProfile.program}
- Current week: ${clientProfile.currentWeek}
- Goal: Progressive overload with sustainable fat loss / muscle building

RECENT CHECK-INS:
${checkinContext || 'No previous check-ins (Week 1)'}

RULES:
- Never prescribe below 1400 calories for women or 1600 for men
- Never recommend banned substances or supplements beyond basics (whey, creatine, multivitamin)
- Keep timelines realistic (0.5-1kg/week fat loss max)
- Progressive overload: increase volume/intensity by 5-10% weekly if compliance is high
- If energy is below 5/10, reduce volume by 15% and increase rest days
- If compliance is below 5/10, simplify the program
- Adjust macros based on weight trend and compliance

Respond in this exact JSON format:
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s", "notes": "optional note" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "macros": { "calories": 2000, "protein": 150, "carbs": 200, "fat": 67 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "items": ["4 egg whites + 1 whole egg scramble", "1 cup oats with banana"] }
    ],
    "notes": "Optional nutrition notes"
  },
  "coach_notes": "Brief 2-3 sentence note about this week's focus and adjustments"
}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }]
  });

  const responseText = response.content[0].text;

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse program JSON from Claude response');

  const program = JSON.parse(jsonMatch[0]);

  if (detectRiskyContent(program)) {
    return { flagged: true, reason: 'Risky content detected in generated program', raw: program };
  }

  return {
    flagged: false,
    workoutPlan: program.workout_plan,
    nutritionPlan: program.nutrition_plan,
    notes: program.coach_notes
  };
}

module.exports = { generateWeeklyProgram, detectRiskyContent };
