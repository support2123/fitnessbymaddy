const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'very low calorie',
  'clenbuterol', 'dnp', 'ephedrine', 'anabolic', 'steroid',
  'lose 10kg in 1 week', 'lose 20 pounds in',
  'extreme cut', 'starvation',
];

function checkSafety(text) {
  const lower = (typeof text === 'string' ? text : JSON.stringify(text)).toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }
  return null;
}

async function generateProgram(client, checkins) {
  const anthropic = new Anthropic();

  const lastTwo = checkins.slice(-2);
  const checkinSummary = lastTwo.map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
  ).join('\n');

  const prompt = `You are a certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Started: ${client.program_started_at}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins (Week 1)'}

Generate a complete weekly program in JSON format with this exact structure:
{
  "workout": {
    "days": [
      {
        "name": "Day 1 - Push",
        "exercises": [
          { "name": "Barbell Bench Press", "sets": "4", "reps": "8-10", "notes": "Control the eccentric" }
        ]
      }
    ]
  },
  "nutrition": {
    "calories": 2200,
    "macros": { "protein": 180, "carbs": 220, "fats": 65 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "description": "4 egg whites + 1 whole egg, oats 50g with berries" }
    ]
  },
  "notes": "Focus on progressive overload this week. Increase bench press by 2.5kg."
}

RULES:
- Never prescribe fewer than 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Base nutrition on the client's most recent check-in data
- 4-6 training days per week depending on program type
- Include rest day guidance
- Keep notes practical and motivating

Return ONLY the JSON object, no markdown fencing.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Claude returned non-JSON response');
    parsed = JSON.parse(jsonMatch[0]);
  }

  const safetyIssue = checkSafety(parsed);
  if (safetyIssue) {
    return { flagged: true, reason: safetyIssue, raw: parsed };
  }

  return {
    flagged: false,
    workout: parsed.workout,
    nutrition: parsed.nutrition,
    notes: parsed.notes,
  };
}

module.exports = { generateProgram };
