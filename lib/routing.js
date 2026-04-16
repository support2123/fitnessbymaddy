// Keyword → program router for Flow B.

export const PROGRAM_CATALOG = {
  '6wk_gym':    { label: '6-Week Burn & Build (Gym)', price_usd: 97,  slug: '6wk-burn-build' },
  '6wk_home':   { label: '6-Week Burn & Build (Home)', price_usd: 97, slug: '6wk-burn-build-home' },
  '12wk':       { label: '12-Week Flagship (Custom)',  price_usd: 200, slug: '12wk-flagship' },
  'pcos':       { label: 'PCOS Warrior',                price_usd: 45,  slug: 'pcos-warrior' },
  '40plus':     { label: '40+ Strong',                  price_usd: 50,  slug: '40plus-strong' },
  'zoom_trial': { label: 'Zoom Trial',                  price_usd: 20,  slug: 'zoom-trial' },
  'zoom_pack':  { label: 'Zoom Coaching Pack',          price_usd: 180, slug: 'zoom-pack' }
};

export function routeFromText(text) {
  if (!text) return null;
  const s = String(text).toLowerCase();
  if (/(fat\s*loss|weight\s*loss|shred|lose\s*weight|burn)/.test(s)) return '6wk_gym';
  if (/(pcos|hormonal|hormone)/.test(s)) return 'pcos';
  if (/(40\+|over\s*40|menopause|joint)/.test(s)) return '40plus';
  if (/(custom|12\s*week|serious|flagship)/.test(s)) return '12wk';
  if (/(trial|zoom|not\s*sure|unsure)/.test(s)) return 'zoom_trial';
  if (/(home\s*workout|no\s*gym|bodyweight)/.test(s)) return '6wk_home';
  if (/(strength|muscle|build)/.test(s)) return '6wk_gym';
  return null;
}

export function checkoutUrl(program, checkoutId) {
  const base = process.env.CHECKOUT_URL_BASE || 'https://fitnessbymaddyy.exlyapp.com/checkout';
  const slug = PROGRAM_CATALOG[program]?.slug || program;
  return checkoutId ? `${base}/${checkoutId}` : `${base}/${slug}`;
}

export function intakeUrl(leadId) {
  const site = process.env.SITE_URL || 'https://fitnessbymaddy.com';
  return `${site}/intake?lead=${encodeURIComponent(leadId)}`;
}

export function checkinUrl(clientId, weekNo) {
  const site = process.env.SITE_URL || 'https://fitnessbymaddy.com';
  return `${site}/checkin?c=${encodeURIComponent(clientId)}&w=${weekNo}`;
}
