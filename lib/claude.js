import Anthropic from '@anthropic-ai/sdk';

let _client = null;
function client() {
  if (_client) return _client;
  const key = process.env.CLAUDE_API_KEY;
  if (!key) throw new Error('CLAUDE_API_KEY missing');
  _client = new Anthropic({ apiKey: key });
  return _client;
}

const SYSTEM = `You are the Program Architect for FitnessByMaddy, a NASM-certified
coach serving clients across IN, UAE, UK and global markets. Given a client
profile and their last two weekly check-ins, output a single JSON object with
this exact schema:

{
  "week_focus": "one-line focus for the week",
  "workout_plan": {
    "days": [
      { "day": "Monday", "title": "...", "blocks": [ { "name": "...", "sets": 3, "reps": "8-10", "rest_s": 90, "notes": "" } ] }
    ]
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 130,
    "carbs_g": 180,
    "fats_g": 55,
    "notes": "",
    "sample_day": [ { "meal": "Breakfast", "items": ["..."] } ]
  },
  "notes": "coaching note to client, <= 2 sentences"
}

RULES (non-negotiable):
- Never prescribe calories below 1,400 for women or 1,600 for men.
- Never recommend banned or prescription substances.
- Never promise timelines like "lose 10kg in 2 weeks".
- If the client reports pain, dizziness, injury, pregnancy, medication, or
  disordered eating signals, set "halt": true and "halt_reason": "<reason>"
  at the top level instead of a plan.
- Respect any injuries/constraints in the profile.
- Keep language plain, warm, and specific. No bro-science.`;

export async function generateProgram({ profile, checkins }) {
  const prompt = `Client profile:\n${JSON.stringify(profile, null, 2)}\n\n` +
                 `Last check-ins (most recent first):\n${JSON.stringify(checkins, null, 2)}\n\n` +
                 `Generate the next-week program now. JSON only. No markdown.`;

  const resp = await client().messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 4096,
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = (resp.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text).join('').trim();

  const jsonMatch = text.match(/\{[\s\S]*\}$/m) || [text];
  let parsed;
  try { parsed = JSON.parse(jsonMatch[0]); }
  catch (e) { throw new Error('Claude returned non-JSON: ' + text.slice(0, 200)); }

  return validateSafety(parsed);
}

function validateSafety(plan) {
  if (plan.halt) return plan;
  const cals = plan?.nutrition_plan?.calories;
  if (typeof cals === 'number' && cals > 0 && cals < 1400) {
    return { halt: true, halt_reason: `calories_too_low_${cals}` };
  }
  const joined = JSON.stringify(plan).toLowerCase();
  const banned = ['clenbuterol', 'dnp', 'ephedrine', 'anabolic', 'sarm', 'steroid'];
  for (const b of banned) if (joined.includes(b)) {
    return { halt: true, halt_reason: `banned_substance_${b}` };
  }
  if (/lose\s*\d{2,}\s*kg.*(week|month)/i.test(joined)) {
    return { halt: true, halt_reason: 'unrealistic_timeline' };
  }
  return plan;
}
