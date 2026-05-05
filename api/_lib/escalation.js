const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'not eating', 'vomiting', 'surgery', 'doctor said'
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout'];

function needsEscalation(text) {
  const lower = (text || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(kw => lower === kw || lower.includes(kw));
}

function classifyIntent(text) {
  const lower = (text || '').toLowerCase();

  if (/fat\s*loss|weight|shred|slim|lean/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone|period|irregular/.test(lower)) return 'pcos';
  if (/40\+?|forty|menopause|joints|joint\s*pain|senior/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|transform|flagship/.test(lower)) return '12wk';
  if (/trial|zoom|not\s*sure|try|test/.test(lower)) return 'zoom_trial';
  if (/home|no\s*gym|bodyweight|at\s*home/.test(lower)) return '6wk_home';

  return null;
}

function getCheckoutUrl(program) {
  const base = 'https://fitnessbymaddyy.exlyapp.com/checkout';
  const slugs = {
    '6wk_gym': '6-week-burn-build-gym',
    '6wk_home': '6-week-burn-build-home',
    '12wk': '12-week-flagship',
    'pcos': 'pcos-warrior',
    '40plus': '40-plus-strong',
    'zoom_trial': 'zoom-trial',
    'zoom_pack': 'zoom-pack'
  };
  return `${base}/${slugs[program] || 'general'}`;
}

function getProgramLabel(program, hinglish) {
  const labels = {
    '6wk_gym': hinglish ? '6-Week Burn & Build (Gym)' : '6-Week Burn & Build (Gym)',
    '6wk_home': hinglish ? '6-Week Burn & Build (Home)' : '6-Week Burn & Build (Home)',
    '12wk': hinglish ? '12-Week Flagship Program' : '12-Week Flagship Program',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': hinglish ? '$20 Zoom Trial' : '$20 Zoom Trial',
    'zoom_pack': 'Zoom Session Pack'
  };
  return labels[program] || program;
}

module.exports = {
  needsEscalation,
  isOptOut,
  classifyIntent,
  getCheckoutUrl,
  getProgramLabel
};
