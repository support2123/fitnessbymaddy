// Map internal program codes -> Exly checkout link.
// Exly currently uses one storefront with per-program slugs/IDs;
// override per-program env vars if you want to point them elsewhere.
const BASE = process.env.EXLY_CHECKOUT_BASE || 'https://fitnessbymaddyy.exlyapp.com/checkout';

const SLUGS = {
  '6wk_gym':    process.env.EXLY_SLUG_6WK_GYM    || '6-week-burn-build',
  '6wk_home':   process.env.EXLY_SLUG_6WK_HOME   || '6-week-burn-build-home',
  '12wk':       process.env.EXLY_SLUG_12WK       || '12-week-flagship',
  'pcos':       process.env.EXLY_SLUG_PCOS       || 'pcos-warrior',
  '40plus':     process.env.EXLY_SLUG_40PLUS     || '40-plus-strong',
  'zoom_trial': process.env.EXLY_SLUG_ZOOM_TRIAL || 'zoom-trial',
  'zoom_pack':  process.env.EXLY_SLUG_ZOOM_PACK  || 'zoom-pack',
};

export function checkoutUrl(program, leadId) {
  const slug = SLUGS[program] || SLUGS['6wk_gym'];
  const lead = leadId ? `?ref=${encodeURIComponent(leadId)}` : '';
  return `${BASE}/${slug}${lead}`;
}

export function intakeUrl(leadId) {
  const base = process.env.PUBLIC_SITE_URL || 'https://fitnessbymaddy.com';
  return `${base}/intake?lead=${encodeURIComponent(leadId)}`;
}

export function checkinUrl(clientId, weekNo) {
  const base = process.env.PUBLIC_SITE_URL || 'https://fitnessbymaddy.com';
  return `${base}/checkin?c=${encodeURIComponent(clientId)}&w=${weekNo}`;
}

export function trialUrl() {
  return checkoutUrl('zoom_trial', null);
}
