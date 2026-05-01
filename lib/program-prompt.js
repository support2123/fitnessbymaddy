function buildProgramPrompt(client, checkins) {
  const latest = checkins[0] || {};
  const previous = checkins[1] || null;

  let trend = '';
  if (previous && latest.weight && previous.weight) {
    const diff = latest.weight - previous.weight;
    trend = diff < 0 ? `Lost ${Math.abs(diff).toFixed(1)}kg since last week.` :
            diff > 0 ? `Gained ${diff.toFixed(1)}kg since last week.` :
            'Weight stable since last week.';
  }

  return `You are a certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${latest.week_no ? latest.week_no + 1 : 1} of ${client.program === '12wk' ? 12 : 6}
- Program started: ${client.program_started_at || 'recently'}

LATEST CHECK-IN (Week ${latest.week_no || 'N/A'}):
- Weight: ${latest.weight || 'not reported'} kg
- Waist: ${latest.waist || 'not reported'} cm
- Compliance: ${latest.compliance_score || 'N/A'}/10
- Energy: ${latest.energy || 'N/A'}/10
- Issues: ${latest.issues || 'none reported'}
- ${trend}

${previous ? `PREVIOUS CHECK-IN (Week ${previous.week_no}):
- Weight: ${previous.weight || 'N/A'} kg
- Waist: ${previous.waist || 'N/A'} cm
- Compliance: ${previous.compliance_score || 'N/A'}/10` : 'No previous check-in data.'}

INSTRUCTIONS:
1. Design a progressive workout plan for the upcoming week (5-6 training days)
2. Design a nutrition plan with daily calorie target and macro split
3. Include warmup and cooldown recommendations
4. Adjust intensity based on compliance and energy scores
5. Address any reported issues or concerns
6. NEVER prescribe extreme calorie deficits (below 1200 kcal for women, 1500 for men)
7. NEVER recommend banned or unapproved supplements
8. NEVER promise specific weight loss timelines
9. If client reports pain or medical issues, note "REQUIRES COACH REVIEW" prominently

Return valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1 - Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min incline walk + dynamic stretches",
        "cooldown": "5 min static stretch"
      }
    ],
    "weekly_notes": ""
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Meal 1", "time": "8:00 AM", "description": "..." }
    ],
    "hydration": "3-4L water daily",
    "supplements": [],
    "notes": ""
  },
  "coach_notes": "One-liner context for the client",
  "requires_review": false
}`;
}

function validateProgramOutput(output) {
  const flags = [];

  if (output.nutrition_plan) {
    if (output.nutrition_plan.calories < 1200) {
      flags.push('Calorie target dangerously low');
    }

    const supps = output.nutrition_plan.supplements || [];
    const banned = ['dnp', 'clenbuterol', 'ephedrine', 'sarms', 'steroids', 'hgh'];
    for (const s of supps) {
      if (banned.some(b => s.toLowerCase().includes(b))) {
        flags.push(`Banned substance detected: ${s}`);
      }
    }
  }

  if (output.requires_review) {
    flags.push('Program flagged for coach review');
  }

  return { safe: flags.length === 0, flags };
}

module.exports = { buildProgramPrompt, validateProgramOutput };
