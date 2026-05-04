function buildProgramPrompt(client, checkins, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  let progressNote = '';
  if (lastCheckin && prevCheckin) {
    const weightDiff = lastCheckin.weight - prevCheckin.weight;
    progressNote = `Weight change: ${weightDiff > 0 ? '+' : ''}${weightDiff.toFixed(1)}kg. `;
    progressNote += `Compliance: ${lastCheckin.compliance_score}/10. Energy: ${lastCheckin.energy}/10. `;
    if (lastCheckin.issues) progressNote += `Issues reported: ${lastCheckin.issues}. `;
  } else if (lastCheckin) {
    progressNote = `First check-in data — Weight: ${lastCheckin.weight}kg. `;
    progressNote += `Compliance: ${lastCheckin.compliance_score}/10. Energy: ${lastCheckin.energy}/10. `;
    if (lastCheckin.issues) progressNote += `Issues: ${lastCheckin.issues}. `;
  }

  return `You are a certified fitness coach creating a weekly training and nutrition program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
${progressNote ? `- Progress: ${progressNote}` : ''}
${lastCheckin?.next_week_focus ? `- Focus area: ${lastCheckin.next_week_focus}` : ''}

RULES (STRICT):
- Never prescribe fewer than 1200 kcal/day for women or 1500 kcal/day for men
- Never mention banned substances, fat burners, or extreme protocols
- Never promise specific weight loss numbers
- Keep exercises safe and appropriate for the client's reported issues
- If the client reported pain or injury, reduce intensity and note "consult physician"
- Progressive overload: slightly increase volume or intensity from previous week

OUTPUT FORMAT (JSON only, no markdown):
{
  "workout": {
    "days": [
      {
        "name": "Day 1 - Upper Body",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s" }
        ],
        "notes": "optional note"
      }
    ]
  },
  "nutrition": {
    "calories": 1800,
    "macros": { "protein": 140, "carbs": 180, "fat": 60 },
    "meals": [
      {
        "name": "Meal 1 - Breakfast",
        "items": ["3 eggs scrambled", "2 toast whole wheat", "1 banana"]
      }
    ]
  },
  "notes": "Brief coach note about this week's focus and adjustments"
}

Generate Week ${weekNo} program now.`;
}

const SAFETY_FLAGS = [
  'dnp', 'clenbuterol', 'ephedra', 'steroids', 'anabolic',
  'crash diet', '500 calories', '400 calories', '300 calories',
  'guaranteed', 'lose 10kg in', 'lose 20 pounds in',
];

function checkSafety(output) {
  if (!output) return { safe: false, reason: 'Empty output' };
  const lower = typeof output === 'string' ? output.toLowerCase() : JSON.stringify(output).toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) {
      return { safe: false, reason: `Contains flagged content: "${flag}"` };
    }
  }
  if (output.nutrition?.calories && output.nutrition.calories < 1200) {
    return { safe: false, reason: `Calories too low: ${output.nutrition.calories}` };
  }
  return { safe: true };
}

module.exports = { buildProgramPrompt, checkSafety };
