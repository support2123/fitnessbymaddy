// Maps free-text intent → program + checkout slug + display name.

const RULES = [
  { test: /\b(fat loss|weight loss|shred|cutting|lean)\b/i,
    program: '6wk_gym', slug: '6-week-burn-build', display: '6-Week Burn & Build', priceUsd: 60 },
  { test: /\b(home|no gym)\b/i,
    program: '6wk_home', slug: '6-week-home', display: '6-Week Home Edition', priceUsd: 45 },
  { test: /\b(pcos|pcod|hormonal)\b/i,
    program: 'pcos', slug: 'pcos-warrior', display: 'PCOS Warrior', priceUsd: 45 },
  { test: /\b(40|menopause|perimenopause|joints|arthr)/i,
    program: '40plus', slug: '40plus-strong', display: '40+ Strong', priceUsd: 50 },
  { test: /\b(custom|12[- ]?week|flagship|serious|1[- ]on[- ]1|coach)/i,
    program: '12wk', slug: '12-week-flagship', display: '12-Week Flagship', priceUsd: 200 },
  { test: /\b(trial|zoom|not sure|help me choose|consult)/i,
    program: 'zoom_trial', slug: 'zoom-trial', display: '$20 Zoom Trial', priceUsd: 20 }
];

export function routeProgram(text) {
  for (const r of RULES) if (r.test.test(text || '')) return r;
  return null;
}

export function checkoutUrl(slug) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${slug}`;
}

export function intakeUrl(leadId) {
  return `https://fitnessbymaddy.com/intake?lead=${encodeURIComponent(leadId)}`;
}

export function checkinUrl(clientId, weekNo) {
  return `https://fitnessbymaddy.com/checkin?c=${encodeURIComponent(clientId)}&w=${weekNo}`;
}
