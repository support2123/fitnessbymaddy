const Anthropic = require("@anthropic-ai/sdk");

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are program_architect, an expert fitness coach working for FitnessByMaddy.
You create personalized weekly training and nutrition plans.

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein": 140,
    "meals": [
      { "meal": "Breakfast", "suggestion": "Oats with protein powder and berries", "approx_calories": 450 }
    ]
  },
  "notes": "Any important notes for the client"
}

Rules:
- Tailor the plan to the client's goals, fitness level, and any constraints.
- Be specific with exercise names, sets, reps, and rest periods.
- Provide practical, achievable meal suggestions.
- Never recommend banned substances or supplements without evidence.
- Keep calorie targets realistic and safe (minimum 1200 for women, 1500 for men).
- Do not suggest unrealistic timelines for weight loss or muscle gain.
- Do not include any text outside the JSON.`;

function buildUserPrompt(client, checkins) {
  const parts = [
    "Client Profile:",
    `- Name: ${client.name}`,
    `- Age: ${client.age || "N/A"}`,
    `- Gender: ${client.gender || "N/A"}`,
    `- Weight: ${client.weight || "N/A"}`,
    `- Height: ${client.height || "N/A"}`,
    `- Goal: ${client.goal || "general fitness"}`,
    `- Fitness Level: ${client.fitness_level || "beginner"}`,
    `- Constraints: ${client.constraints || "none"}`,
  ];

  if (checkins && checkins.length > 0) {
    parts.push("", "Recent Check-ins:");
    for (const c of checkins.slice(0, 2)) {
      parts.push(
        `- Week ${c.week_no || "?"}: weight=${c.weight || "N/A"}, adherence=${c.adherence || "N/A"}, notes="${c.notes || ""}"`
      );
    }
  }

  parts.push("", "Generate this week's program.");
  return parts.join("\n");
}

function checkSafetyGuardrails(plan, client) {
  const gender = (client.gender || "").toLowerCase();
  const calories = plan.nutrition_plan && plan.nutrition_plan.calories;

  if (calories) {
    const minCalories = gender === "male" ? 1500 : 1200;
    if (calories < minCalories) {
      return `Calorie target ${calories} is below safe minimum (${minCalories}) for ${gender || "unknown gender"}`;
    }
  }

  const bannedSubstances = [
    "steroid",
    "sarm",
    "clenbuterol",
    "dnp",
    "ephedra",
    "hgh",
    "testosterone injection",
    "anavar",
    "dianabol",
  ];
  const planText = JSON.stringify(plan).toLowerCase();
  for (const substance of bannedSubstances) {
    if (planText.includes(substance)) {
      return `Plan references banned substance: ${substance}`;
    }
  }

  if (plan.notes) {
    const notesLower = plan.notes.toLowerCase();
    if (notesLower.includes("lose") && notesLower.match(/\d+\s*kg.*(?:week|day)/)) {
      const match = notesLower.match(/(\d+)\s*kg/);
      if (match && parseInt(match[1]) > 1) {
        return "Potentially unrealistic weight loss timeline in notes";
      }
    }
  }

  return null;
}

async function generateProgram(client, checkins) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const anthropic = new Anthropic({ apiKey });
  const userPrompt = buildUserPrompt(client, checkins);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content[0].text.trim();

  let plan;
  try {
    plan = JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Claude response was not valid JSON");
    }
    plan = JSON.parse(jsonMatch[0]);
  }

  const flagReason = checkSafetyGuardrails(plan, client);

  return {
    plan,
    flagged: flagReason !== null,
    flagReason: flagReason || null,
  };
}

module.exports = { generateProgram };
