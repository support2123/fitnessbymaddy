// Claude API — program architect. Returns structured JSON: workout + nutrition + notes.

const SYSTEM = `You are "Program Architect" for FitnessByMaddy — a NASM-certified coach.
Output rules:
- Always respond with a single JSON object, no prose outside JSON.
- Schema: {"workout_plan":{"split":"...","days":[{"day":"Mon","focus":"...","exercises":[{"name":"...","sets":3,"reps":"8-10","rest":"90s","notes":"..."}]}]},"nutrition_plan":{"kcal_target":2000,"protein_g":140,"carbs_g":200,"fats_g":60,"meals":[{"meal":"Breakfast","items":["..."],"notes":"..."}],"hydration_l":3},"notes":"coach voice — what changed this week and why, 2-3 sentences"}
- Be evidence-based. No bro-science. No banned substances. No starvation (kcal_target must be >= 1400 for women, >= 1700 for men).
- Weekly rate of loss should be realistic (0.5–1% bodyweight max).
- Respect injuries and constraints from profile + last check-ins.
- Keep it Maddy's voice: warm, precise, no hype. Hinglish OK if client's market is IN.`;

export async function generateProgram({ client, profile, lastCheckins }) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) throw new Error('CLAUDE_API_KEY missing');
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

  const userPayload = {
    client: {
      name: client.name, program: client.program, started: client.program_started_at,
      market: client.market
    },
    profile,
    last_checkins: lastCheckins
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(userPayload) }]
    })
  });

  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.content?.[0]?.text?.trim() || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude returned non-JSON');
  return JSON.parse(jsonMatch[0]);
}

// Safety gate — halt if the plan looks risky.
export function riskCheck(plan) {
  const reasons = [];
  const kcal = Number(plan?.nutrition_plan?.kcal_target);
  if (!kcal || kcal < 1200) reasons.push(`kcal_target=${kcal} below safe floor`);

  const text = JSON.stringify(plan).toLowerCase();
  const banned = [
    'clenbuterol', 'anavar', 'dnp', 'ephedrine', 'winstrol', 'steroid',
    'laxative', 'purge', 'starve', 'fasted 20', 'fasted 24', 'water only'
  ];
  for (const term of banned) {
    if (text.includes(term)) reasons.push(`contains banned term: ${term}`);
  }
  if (/lose\s+\d{2}\s*kg\s+in\s+[1-3]\s*week/.test(text)) {
    reasons.push('unrealistic timeline promise');
  }
  return reasons;
}
