const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 800', 'under 1000 cal',
  'banned substance', 'steroid', 'sarm', 'clenbuterol', 'dnp',
  '30 pounds in a week', '20kg in 2 weeks', 'crash diet',
  'fat burner pill', 'laxative'
];

async function generateWeeklyProgram(client, checkins) {
  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const lastTwoCheckins = checkins.slice(-2);
  const checkinSummary = lastTwoCheckins.map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`
  ).join('\n');

  const currentWeek = lastTwoCheckins.length > 0
    ? Math.max(...lastTwoCheckins.map(c => c.week_no)) + 1
    : 1;

  const prompt = `You are an elite fitness program architect working for Fitness by Maddy, a NASM-certified personal trainer.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program} (Week ${currentWeek} of 12)
- Age: ${client.age || 'Not specified'}
- Goal: ${client.goal || 'Body transformation'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}

RECENT CHECK-IN DATA:
${checkinSummary || 'No previous check-ins (Week 1)'}

Generate a complete weekly program in JSON format with two keys:
1. "workout_plan" — 5-6 training days with exercises, sets, reps, rest periods, and RPE targets
2. "nutrition_plan" — daily calorie target, macros (protein/carbs/fats in grams), meal timing, sample meals

Also include a "coach_note" string (2-3 sentences, warm + expert tone) explaining what this week focuses on and why.

RULES:
- Progressive overload from previous weeks
- Adjust based on compliance and energy scores
- If compliance < 5, simplify the program
- If energy < 4, reduce volume by 20%
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend supplements beyond protein, creatine, and multivitamins
- Never suggest extreme measures or unrealistic timelines

Return ONLY valid JSON with keys: workout_plan, nutrition_plan, coach_note`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text;

  // Safety check
  const lowerText = text.toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lowerText.includes(flag)) {
      return {
        success: false,
        flagged: true,
        reason: `Safety flag triggered: "${flag}"`,
        raw: text
      };
    }
  }

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    const parsed = JSON.parse(jsonMatch[0]);

    return {
      success: true,
      week_no: currentWeek,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      coach_note: parsed.coach_note || '',
      raw: text
    };
  } catch (err) {
    return {
      success: false,
      flagged: false,
      reason: `Failed to parse program JSON: ${err.message}`,
      raw: text
    };
  }
}

module.exports = { generateWeeklyProgram };
