// Claude API call for weekly program generation.
// Uses the program_architect system prompt. Returns parsed JSON.

const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';

const PROGRAM_ARCHITECT_SYSTEM = `You are Maddy's program architect — a NASM-certified coach's AI assistant.

Generate a safe, personalised weekly workout + nutrition plan for one client based on their profile and the last two check-ins.

HARD RULES
- Never prescribe extreme calorie cuts (< 1100 kcal/day for women, < 1400 for men).
- Never recommend banned substances (steroids, clen, DNP, semaglutide, HCG, diuretics, laxatives).
- Never promise more than 0.5–1 kg loss per week.
- If the client reports pain / injury / medical concern, reduce intensity and flag "needs_review": true.
- Respect equipment constraint (gym vs home) and dietary preference (veg / non-veg / vegan).

OUTPUT FORMAT (strict JSON, no prose, no markdown fences):
{
  "workout_plan": {
    "days": [
      { "day": 1, "focus": "Upper push", "exercises": [ { "name": "", "sets": 3, "reps": "8-10", "rest_sec": 90, "notes": "" } ] }
    ],
    "weekly_cardio_min": 0,
    "mobility_daily_min": 0
  },
  "nutrition_plan": {
    "daily_calories": 1800,
    "macros_g": { "protein": 130, "carbs": 200, "fat": 55 },
    "meal_framework": [ { "meal": "Breakfast", "ideas": ["..."] } ],
    "hydration_l": 3,
    "supplements": ["optional basics only"]
  },
  "notes": "1–2 sentence coaching note on focus for this week.",
  "needs_review": false
}`;

export async function generateProgram({ client, profile, checkins, weekNo }) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY missing');
  const model = process.env.CLAUDE_MODEL || 'claude-opus-4-6';

  const userPayload = {
    week_no: weekNo,
    client: {
      name: client.name,
      program: client.program,
      started_at: client.program_started_at,
      market: client.market || null
    },
    profile: profile || {},
    recent_checkins: checkins || []
  };

  const res = await fetch(CLAUDE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 3000,
      system: PROGRAM_ARCHITECT_SYSTEM,
      messages: [{
        role: 'user',
        content: `Generate Week ${weekNo} plan. Client context:\n\n${JSON.stringify(userPayload, null, 2)}\n\nRespond with the strict JSON only.`
      }]
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Claude API ${res.status}: ${txt.slice(0, 300)}`);
  }
  const body = await res.json();
  const text = body?.content?.[0]?.text || '';
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd < 0) {
    throw new Error('Claude did not return JSON');
  }
  return JSON.parse(text.slice(jsonStart, jsonEnd + 1));
}
