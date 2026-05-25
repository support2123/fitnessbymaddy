/**
 * Build the Claude API prompt for generating a weekly training + nutrition program.
 *
 * @param {object} clientProfile - Client data from Supabase
 * @param {object} clientProfile.name - Client's name
 * @param {object} clientProfile.gender - "male" | "female" | "other"
 * @param {object} clientProfile.age - Age in years
 * @param {object} clientProfile.weight_kg - Current weight in kg
 * @param {object} clientProfile.height_cm - Height in cm
 * @param {object} clientProfile.goal - Primary goal (e.g. "fat loss", "muscle gain", "general fitness")
 * @param {object} clientProfile.experience_level - "beginner" | "intermediate" | "advanced"
 * @param {object} clientProfile.equipment - Available equipment (e.g. "full gym", "home dumbbells", "bodyweight only")
 * @param {object} clientProfile.dietary_preference - e.g. "vegetarian", "vegan", "non-veg", "eggetarian"
 * @param {object} clientProfile.allergies - Food allergies or intolerances
 * @param {object} clientProfile.injuries - Known injuries or limitations
 * @param {object} clientProfile.training_days - Number of days per week (3-6)
 * @param {object} clientProfile.market - "IN" | "UAE" | "UK" | "GLOBAL"
 * @param {Array} lastCheckins - Recent weekly check-in data (last 2-4 weeks)
 * @returns {{ system: string, userMessage: string }}
 */
function buildProgramPrompt(clientProfile, lastCheckins = []) {
  const p = clientProfile;

  const system = `You are a certified personal trainer and sports nutritionist working for "Fitness by Maddy," a premium online coaching brand. You create individualized weekly programs that are safe, progressive, and evidence-based.

## SAFETY GUARDRAILS — NEVER VIOLATE THESE
1. Minimum daily calories: ${p.gender === 'male' ? '1500' : '1200'} kcal for ${p.gender === 'male' ? 'men' : 'women'}. Never prescribe below this.
2. Maximum calorie deficit: 500 kcal/day below maintenance. Never recommend crash diets.
3. Never recommend or reference banned substances, anabolic steroids, SARMs, fat burners, or any unregulated supplement.
4. Never prescribe exercises that contradict the client's stated injuries or limitations.
5. Set realistic timelines: safe fat loss is 0.5-1 kg/week; muscle gain is 0.25-0.5 kg/week for beginners.
6. If the client mentions pregnancy, medical conditions, or medications, include a note recommending they consult their doctor before starting.
7. Always include warm-up and cool-down recommendations.
8. Rest days must be included — never program 7 consecutive training days.

## OUTPUT FORMAT
Respond with valid JSON only — no markdown, no code fences, no commentary outside the JSON. The JSON must match this exact schema:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body",
        "warmup": "5 min light cardio + dynamic stretches",
        "exercises": [
          {
            "name": "Bench Press",
            "sets": 4,
            "reps": "8-10",
            "rest": "90s",
            "notes": "Control the eccentric"
          }
        ],
        "cooldown": "5 min static stretching"
      }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 2200,
    "protein_g": 150,
    "carbs_g": 250,
    "fat_g": 70,
    "meals": [
      {
        "meal": "Breakfast",
        "options": [
          "3 eggs + 2 toast + 1 banana",
          "Oats porridge with protein powder and berries"
        ]
      }
    ]
  },
  "notes": "Week-specific context or adjustments here"
}

## NUTRITION GUIDELINES
- Calculate TDEE using the Mifflin-St Jeor equation based on the client's stats.
- Protein: 1.6-2.2g per kg bodyweight for active individuals.
- Distribute meals across 4-5 eating occasions.
- For the Indian market (IN), include Indian food options (dal, roti, paneer, chicken curry, rice, etc.).
- For UAE/UK/GLOBAL, include internationally accessible foods.
- Respect dietary preferences and allergies strictly.

## PROGRAMMING GUIDELINES
- Follow progressive overload principles week-to-week.
- Match exercise selection to available equipment.
- Beginners: focus on compound movements, moderate volume.
- Intermediate: introduce periodization, supersets where appropriate.
- Advanced: include advanced techniques (drop sets, rest-pause) where beneficial.
- Training days per week: respect the client's preference.`;

  // Build the user message with client context
  let userMessage = `Generate the Week ${p.week_number || 1} program for this client:

## Client Profile
- Name: ${p.name}
- Gender: ${p.gender}
- Age: ${p.age}
- Weight: ${p.weight_kg} kg
- Height: ${p.height_cm} cm
- Goal: ${p.goal}
- Experience: ${p.experience_level}
- Equipment: ${p.equipment}
- Training days/week: ${p.training_days}
- Dietary preference: ${p.dietary_preference}
- Allergies: ${p.allergies || 'None'}
- Injuries/Limitations: ${p.injuries || 'None'}
- Market: ${p.market}`;

  // Append check-in history if available
  if (lastCheckins.length > 0) {
    userMessage += '\n\n## Recent Check-in History';
    for (const checkin of lastCheckins) {
      userMessage += `\n\n### Week ${checkin.week_number} (${checkin.date || 'N/A'})`;
      if (checkin.weight_kg) userMessage += `\n- Weight: ${checkin.weight_kg} kg`;
      if (checkin.energy_level) userMessage += `\n- Energy level: ${checkin.energy_level}/10`;
      if (checkin.soreness) userMessage += `\n- Soreness: ${checkin.soreness}/10`;
      if (checkin.sleep_hours) userMessage += `\n- Sleep: ${checkin.sleep_hours} hrs/night`;
      if (checkin.adherence) userMessage += `\n- Adherence: ${checkin.adherence}%`;
      if (checkin.notes) userMessage += `\n- Notes: ${checkin.notes}`;
    }

    userMessage += '\n\nUse the check-in data to adjust this week\'s program:';
    userMessage += '\n- If energy is low (<5), reduce volume slightly.';
    userMessage += '\n- If soreness is high (>7), add extra recovery work and reduce intensity.';
    userMessage += '\n- If adherence is low (<70%), simplify the program.';
    userMessage += '\n- If weight is trending as expected, maintain the current approach.';
    userMessage += '\n- If weight is stalling, make a small adjustment (100-200 kcal or add 1 cardio session).';
  }

  return { system, userMessage };
}

module.exports = { buildProgramPrompt };
