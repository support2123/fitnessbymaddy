// Classify an inbound lead message into a program bucket + checkout URL.

const KEYWORDS = [
  { match: /(pcos|hormon|pcod)/i, program: 'pcos', checkoutKey: 'CHECKOUT_PCOS' },
  { match: /(40\+|forty|menopaus|peri[-\s]?meno|joint|knee)/i, program: '40plus', checkoutKey: 'CHECKOUT_40PLUS' },
  { match: /(custom|12\s*-?\s*week|twelve\s*week|flagship|serious|1.?on.?1|personal)/i, program: '12wk', checkoutKey: 'CHECKOUT_12WK' },
  { match: /(trial|zoom|demo|not\s*sure|try\s*first)/i, program: 'zoom_trial', checkoutKey: 'CHECKOUT_ZOOM_TRIAL' },
  { match: /(home.?workout|no\s*gym|body\s*weight)/i, program: '6wk_home', checkoutKey: 'CHECKOUT_6WK_HOME' },
  { match: /(fat\s*loss|weight|shred|lose|slim|tone|burn|cut)/i, program: '6wk_gym', checkoutKey: 'CHECKOUT_6WK_GYM' },
  { match: /(strength|muscle|build|lean|gain)/i, program: '6wk_gym', checkoutKey: 'CHECKOUT_6WK_GYM' },
];

function routeFromText(text) {
  if (!text) return null;
  for (const rule of KEYWORDS) {
    if (rule.match.test(text)) {
      return {
        program: rule.program,
        checkoutId: process.env[rule.checkoutKey] || null,
      };
    }
  }
  return null;
}

function checkoutUrl(checkoutId) {
  if (!checkoutId) return null;
  const base = process.env.EXLY_CHECKOUT_BASE || 'https://fitnessbymaddyy.exlyapp.com/checkout';
  return `${base}/${checkoutId}`;
}

function intakeUrl(leadIdOrClientId) {
  const base = process.env.PUBLIC_BASE_URL || 'https://fitnessbymaddy.com';
  return `${base}/intake?lead=${leadIdOrClientId}`;
}

function trialUrl() {
  return checkoutUrl(process.env.CHECKOUT_ZOOM_TRIAL);
}

module.exports = { routeFromText, checkoutUrl, intakeUrl, trialUrl };
