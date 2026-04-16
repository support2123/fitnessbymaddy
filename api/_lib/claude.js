// Claude-based weekly program architect.
// Safety: reject + flag if output contains extreme calorie cuts, banned substances,
// or unrealistic timelines.

const Anthropic = require('@anthropic-ai/sdk');

const MIN_CALORIES_WOMEN = 1200;
const MIN_CALORIES_MEN = 1500;

const BANNED_PATTERNS = [
  /\bclenbuterol\b/i, /\banavar\b/i, /\bwinstrol\b/i, /\bephedr/i,
  /\bdnp\b/i, /\bsteroid/i, /\bsarm\b/i, /\bdiuretic/i,
  /\blaxative.*(weight|loss)/i, /\binduce\s*vomit/i,
  /\bfast(ing)?\s*\d{3,}\s*hours?/i,
];

function risky(textBlob) {
  if (!textBlob) return null;
  for (const p of BANNED_PATTERNS) if (p.test(textBlob)) return `banned_pattern:${p.source}`;
  const calMatch = textBlob.match(/(\d{3,4})\s*(kcal|calories|cals)/gi) || [];
  for (const m of calMatch) {
    const n = parseInt(m.match(/\d+/)[0], 10);
    if (n < 1000) return `extreme_calorie_cut:${n}`;
  }
  if (/lose\s*(\d+)\s*kg.*week/i.test(textBlob)) {
    const n = parseInt(textBlob.match(/lose\s*(\d+)\s*kg/i)[1], 10);
    if (n > 2) return `unrealistic_weekly_loss:${n}`;
  }
  return null;
}

const SYSTEM_PROMPT = `You are "Maddy's Program Architect" — a NASM-certified coach's planning brain.

OUTPUT CONTRACT (strict JSON, no prose):
{
  "week_no": <int>,
  "focus": "<1 line>",
  "workout_plan": {
    "split": "<e.g. Upper/Lower/Rest/Full/Cardio>",
    "days": [
      { "day": 1, "title": "", "warmup": [""], "main": [ {"exercise":"", "sets":3, "reps":"8-10", "rest_sec":90, "notes":""} ], "finisher": "", "duration_min": 45 }
    ],
    "cardio": "",
    "mobility": ""
  },
  "nutrition_plan": {
    "kcal_target": <int>,
    "protein_g": <int>, "carbs_g": <int>, "fat_g": <int>,
    "meals": [ { "name":"", "items":[""], "notes":"" } ],
    "hydration_l": <number>,
    "supplements": [""]
  },
  "coach_notes": "<2-3 lines, warm, expert, never bro-sciency>"
}

HARD RULES:
- Never go below ${MIN_CALORIES_WOMEN} kcal for women, ${MIN_CALORIES_MEN} kcal for men.
- Never suggest steroids, SARMs, clenbuterol, DNP, diuretics, or fasting >36h.
- Never promise >1 kg fat loss per week sustainably.
- Adjust for injuries, PCOS, 40+, equipment access from the profile.
- Respect the last 2 check-ins: if compliance low → simplify; if energy low → deload;
  if issues include joint pain → substitute joint-friendly variations.
- Tone in coach_notes: warm + expert. Hinglish OK if client market is IN.
- Return ONLY the JSON object. No markdown, no commentary.`;

async function generatePlan({ client, checkins = [] }) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) throw new Error('CLAUDE_API_KEY missing');
  const sdk = new Anthropic({ apiKey: key });

  const userPayload = {
    client: {
      name: client.name, program: client.program, market: client.market,
      program_started_at: client.program_started_at,
      program_ends_at: client.program_ends_at,
    },
    week_no: (checkins[0]?.week_no || 0) + 1,
    last_checkins: checkins,
  };

  const msg = await sdk.messages.create({
    model: process.env.CLAUDE_MODEL || 'claude-opus-4-6',
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: 'Generate next week plan for:\n' + JSON.stringify(userPayload, null, 2),
    }],
  });

  const text = (msg.content || []).map((b) => (b.type === 'text' ? b.text : '')).join('\n');
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd < 0) throw new Error('claude_no_json');
  const plan = JSON.parse(text.slice(jsonStart, jsonEnd + 1));

  const flat = JSON.stringify(plan);
  const riskReason = risky(flat);
  if (riskReason) {
    return { plan, flagged: true, flag_reason: riskReason };
  }
  return { plan, flagged: false };
}

module.exports = { generatePlan, risky };
