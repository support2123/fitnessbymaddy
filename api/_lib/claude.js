// Claude API wrapper for weekly program generation.
// Keeps the safety filter + JSON parsing contract in one place.

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-6';

const SYSTEM_PROMPT = `You are "Program Architect", a senior NASM-certified
coach writing weekly training + nutrition plans for FitnessByMaddy clients.

HARD RULES (violate any → refuse with {"error":"unsafe","reason":"..."}):
- Never prescribe calorie deficits below 1200 kcal for women / 1500 for men.
- Never recommend supplements beyond whey, creatine, multivitamin, vitamin D, omega-3.
- Never suggest fasted cardio for PCOS, 40+, or underweight clients.
- Never promise weight loss rate > 0.8 kg/week.
- Never mention banned substances, SARMs, steroids, fat burners.
- If injury/medication/pregnancy flagged in intake, refuse and flag for review.

TONE:
- Warm, direct, no bro-science, no hype.
- Hinglish allowed for IN market, English otherwise.

OUTPUT: strictly valid JSON matching this schema:
{
  "week_focus": "one-liner, under 80 chars",
  "workout_plan": {
    "days": [
      { "day": 1, "title": "…", "blocks": [
        { "name": "…", "sets": 3, "reps": "8-10", "rest_sec": 90, "notes": "…" }
      ]}
    ]
  },
  "nutrition_plan": {
    "target_kcal": 1800,
    "protein_g": 130, "carbs_g": 200, "fat_g": 60,
    "meals": [ { "name": "Breakfast", "options": ["…","…"] } ],
    "notes": "…"
  },
  "coach_note": "2-3 sentence message Maddy would send with the plan"
}
No prose outside the JSON. No code fences.`;

// Input: client profile + last 2 check-ins. Output: parsed JSON plan.
export async function generateProgram({ client, lastCheckins, weekNo }) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) throw new Error('CLAUDE_API_KEY not set');

  const userPayload = {
    week_no: weekNo,
    client: {
      name: client.name,
      program: client.program,
      market: deriveMarket(client.phone),
      intake: client.intake_json || {},
    },
    recent_checkins: (lastCheckins || []).map(c => ({
      week_no: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance_score: c.compliance_score,
      energy: c.energy,
      issues: c.issues,
      next_week_focus: c.next_week_focus,
    })),
  };

  const res = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.content?.[0]?.text?.trim() || '';
  // Strip accidental code fences just in case.
  const clean = text.replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();

  let parsed;
  try { parsed = JSON.parse(clean); }
  catch (e) { throw new Error('claude_non_json: ' + clean.slice(0, 200)); }

  if (parsed.error === 'unsafe') {
    return { flagged: true, reason: parsed.reason, raw: parsed };
  }
  const safetyIssue = runSafetyFilter(parsed, client);
  if (safetyIssue) return { flagged: true, reason: safetyIssue, raw: parsed };
  return { flagged: false, plan: parsed };
}

// Belt-and-suspenders safety filter — runs locally even if Claude returns
// a plausible plan. Anything borderline gets flagged for Maddy.
function runSafetyFilter(plan, client) {
  const kcal = plan?.nutrition_plan?.target_kcal;
  if (kcal && kcal < 1200) return `unsafe_kcal_${kcal}`;

  const text = JSON.stringify(plan).toLowerCase();
  const banned = ['sarms', 'steroid', 'clenbuterol', 'dnp', 'ephedrine', 'fat burner'];
  for (const b of banned) if (text.includes(b)) return `banned_substance_${b}`;

  // 40+ / PCOS clients must not get fasted cardio.
  if (['pcos','40plus'].includes(client.program) && /fasted\s+cardio/i.test(text)) {
    return 'fasted_cardio_for_sensitive_program';
  }
  return null;
}

function deriveMarket(phone) {
  if (!phone) return 'GLOBAL';
  if (phone.startsWith('+91'))  return 'IN';
  if (phone.startsWith('+971')) return 'UAE';
  if (phone.startsWith('+44'))  return 'UK';
  return 'GLOBAL';
}
