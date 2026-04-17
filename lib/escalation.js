const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex',
  'bulimi', 'vomit', 'faint', 'hospital',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

async function escalateToMaddy(reason, details) {
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    details.substring(0, 200),
  ]);
}

function routeProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/fat\s*loss|weight|shred|lean|cut/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|period|cycle/.test(lower)) return 'pcos';
  if (/40|menopause|joint|senior|age/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|transform|flagship/.test(lower)) return '12wk';
  if (/trial|zoom|not sure|try|test/.test(lower)) return 'zoom_trial';
  if (/home|no\s*gym|bodyweight|at\s*home/.test(lower)) return '6wk_home';

  return null;
}

function programLabel(code) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Coaching Pack',
  };
  return labels[code] || code;
}

function checkoutUrl(program) {
  const slugs = {
    '6wk_gym': '6-week-burn-build-gym',
    '6wk_home': '6-week-burn-build-home',
    '12wk': '12-week-custom-flagship',
    'pcos': 'pcos-warrior',
    '40plus': '40-plus-strong',
    'zoom_trial': 'zoom-trial',
    'zoom_pack': 'zoom-coaching-pack',
  };
  const slug = slugs[program] || 'zoom-trial';
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${slug}`;
}

module.exports = {
  needsEscalation,
  escalateToMaddy,
  routeProgram,
  programLabel,
  checkoutUrl,
  ESCALATION_KEYWORDS,
};
