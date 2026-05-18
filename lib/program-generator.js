const Anthropic = require('@anthropic-ai/sdk');

const RISKY_PATTERNS = [
  /below\s*\d{3,4}\s*cal/i,
  /under\s*800\s*cal/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedra/i,
  /sarm/i,
  /steroid/i,
  /lose\s*\d+\s*kg\s*in\s*\d+\s*day/i,
];

async function generateWeeklyProgram(clientProfile, lastCheckins) {
  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const systemPrompt = `You are the Program Architect for FitnessByMaddy, an elite online coaching brand.
Generate a weekly workout and nutrition plan based on the client's profile and recent check-in data.

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": { "type": "Incline Walk", "duration": "20min", "intensity": "moderate" }
      }
    ],
    "deload_notes": ""
  },
  "nutrition_plan": {
    "daily_calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meal_timing": [
      { "meal": "Meal 1 - Pre-Workout", "time": "7:00 AM", "description": "", "calories": 500 }
    ],
    "hydration": "3-4 liters daily",
    "supplements": ["Whey protein", "Creatine 5g", "Vitamin D3"]
  },
  "weekly_focus": "Progressive overload on compound lifts, increase protein intake",
  "context_note": "One-liner for WhatsApp message to client"
}

Rules:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances, SARMs, steroids, or extreme protocols
- Keep it evidence-based and sustainable
- Consider injuries, preferences, and compliance from check-in data
- If the client's compliance is low, simplify rather than add complexity`;

  const userPrompt = `Client Profile:
${JSON.stringify(clientProfile, null, 2)}

Last Check-ins:
${JSON.stringify(lastCheckins, null, 2)}

Generate the next week's program.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse program JSON from Claude response');

  const program = JSON.parse(jsonMatch[0]);

  const programStr = JSON.stringify(program).toLowerCase();
  const flagged = RISKY_PATTERNS.some(p => p.test(programStr));

  return { program, flagged, flagReason: flagged ? 'Content matched safety filter' : null };
}

module.exports = { generateWeeklyProgram };
