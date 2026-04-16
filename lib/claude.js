// Claude "program architect" — turns a client profile + recent check-ins into a
// structured weekly workout + nutrition plan. Safety-checks output before use.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-6';

let _client = null;
function client() {
  if (_client) return _client;
  if (!process.env.CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY missing');
  _client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  return _client;
}

const SYSTEM = `You are Maddy's "Program Architect" — an evidence-based coaching assistant.
You output a safe, personalised weekly workout + nutrition plan as STRICT JSON only.

Hard rules:
- Never prescribe <1500 kcal/day for women or <1800 kcal/day for men.
- Never recommend supplements beyond: whey protein, creatine monohydrate, vitamin D, omega-3.
- Never promise specific weight loss in a timeframe.
- Respect injuries / medical conditions listed in the profile: avoid loaded spinal flexion for
  back issues, deep knee flexion under load for knee issues, high-impact for pregnancy etc.
- If the profile is incomplete or flags real risk (chest pain, dizziness, pregnancy, eating
  disorder signals), return: { "halt": true, "reason": "<short>" } and nothing else.

Output schema (JSON, no prose):
{
  "week_focus": "one sentence",
  "workout": {
    "days_per_week": number,
    "sessions": [
      { "day": "Mon", "name": "Push", "blocks": [
          { "exercise": "Goblet squat", "sets": 3, "reps": "8-10", "rest_s": 90, "cue": "..." }
      ]}
    ]
  },
  "nutrition": {
    "kcal_target": number,
    "protein_g": number,
    "carb_g": number,
    "fat_g": number,
    "meal_pattern": ["...", "..."],
    "notes": "..."
  },
  "weekly_notes": "2-4 short bullets, coach-to-athlete tone"
}`;

export async function generatePlan({ client: c, checkins }) {
  const userPayload = {
    client: {
      name: c.name, program: c.program, age: c.age, sex: c.sex,
      height_cm: c.height_cm, goal: c.goal, injuries: c.injuries,
      diet_pref: c.diet_pref, equipment: c.equipment, schedule: c.schedule
    },
    recent_checkins: (checkins || []).map(x => ({
      week_no: x.week_no,
      weight: x.weight, waist: x.waist,
      compliance_score: x.compliance_score, energy: x.energy,
      issues: x.issues
    }))
  };

  const msg = await client().messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(userPayload) }]
  });

  const text = msg.content.map(p => p.type === 'text' ? p.text : '').join('').trim();
  let plan;
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    plan = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    return { ok: false, reason: 'parse_error', raw: text };
  }

  if (plan.halt) return { ok: false, reason: 'model_halt', detail: plan.reason };

  const check = safetyCheck(plan, c);
  if (!check.ok) return { ok: false, reason: check.reason, plan };

  return { ok: true, plan };
}

// Deterministic safety gate that runs AFTER the model.
export function safetyCheck(plan, clientProfile = {}) {
  try {
    const kcal = plan?.nutrition?.kcal_target;
    if (typeof kcal !== 'number') return { ok: false, reason: 'nutrition_missing' };
    const minKcal = (clientProfile.sex === 'M') ? 1800 : 1500;
    if (kcal < minKcal) return { ok: false, reason: 'kcal_too_low' };

    const sessions = plan?.workout?.sessions;
    if (!Array.isArray(sessions) || sessions.length === 0)
      return { ok: false, reason: 'workout_missing' };

    const flat = JSON.stringify(plan).toLowerCase();
    const banned = ['clenbuterol','anavar','winstrol','dnp','ephedrine','ozempic','semaglutide'];
    for (const b of banned) if (flat.includes(b)) return { ok: false, reason: `banned_substance:${b}` };

    // Guard against unrealistic promises
    if (/lose \d+ ?kg in \d+ (day|week)/.test(flat)) return { ok: false, reason: 'unrealistic_promise' };

    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'safety_check_error' };
  }
}
