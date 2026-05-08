const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic.default({ apiKey: process.env.CLAUDE_API_KEY });

const SAFETY_FLAGS = [
  'below 1000 calories', 'below 800 calories', 'very low calorie',
  'clenbuterol', 'dnp', 'ephedra', 'steroids', 'sarms',
  'lose 10kg in 1 week', 'lose 20 pounds in 2 weeks',
  'extreme deficit', 'water fast', 'dry fast'
];

function checkSafety(text) {
  const lower = (typeof text === 'string' ? text : JSON.stringify(text)).toLowerCase();
  return SAFETY_FLAGS.filter(flag => lower.includes(flag));
}

async function generateWeeklyProgram({ client: clientData, checkins, weekNo }) {
  const lastTwo = (checkins || []).slice(-2);

  const systemPrompt = `You are a NASM-certified fitness coach creating a weekly program for a client of "Fitness by Maddy".
You must return ONLY valid JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein": 150,
    "carbs": 200,
    "fat": 70,
    "meals": [
      {
        "name": "Breakfast",
        "options": ["Option A description", "Option B description"]
      }
    ]
  },
  "notes": "Coach notes for the week"
}

Rules:
- Never prescribe below 1200 kcal for women or 1500 kcal for men
- Never recommend any banned substances or supplements that require medical supervision
- Keep timelines realistic (0.5-1kg per week fat loss max)
- Consider injuries and limitations listed in the client profile
- Progressively overload from previous weeks
- Be warm and encouraging in notes, use the client's name`;

  const userPrompt = `Client profile:
Name: ${clientData.name}
Program: ${clientData.program}
Week: ${weekNo} of ${clientData.program === '12wk' ? 12 : 6}

${lastTwo.length > 0 ? `Recent check-ins:
${lastTwo.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')}` : 'No previous check-ins (first week).'}

Generate the Week ${weekNo} program.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });

  const text = response.content[0].text;

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude did not return valid JSON');

  const program = JSON.parse(jsonMatch[0]);

  const violations = checkSafety(program);
  if (violations.length > 0) {
    return { program, safe: false, violations };
  }

  return { program, safe: true, violations: [] };
}

module.exports = { generateWeeklyProgram, checkSafety };
