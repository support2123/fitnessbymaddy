const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'shred', 'lean', 'burn', 'cut', 'gym'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period', 'pcod'],
  '40plus': ['40+', '40 plus', 'forty', 'menopause', 'joints', 'joint pain', 'over 40'],
  '12wk': ['custom', '12 week', '12-week', 'serious', 'flagship', 'transform', 'complete'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'demo'],
};

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'opt-out', 'leave me alone'];

function classifyIntent(message) {
  const lower = (message || '').toLowerCase();

  if (OPT_OUT_KEYWORDS.some(kw => lower.includes(kw))) {
    return { intent: 'opt_out', program: null };
  }

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return { intent: 'program_interest', program };
    }
  }

  if (lower.includes('home') && (lower.includes('workout') || lower.includes('exercise'))) {
    return { intent: 'program_interest', program: '6wk_home' };
  }

  return { intent: 'general', program: null };
}

function getProgramCheckoutUrl(program) {
  const checkoutIds = {
    '6wk_gym': '6week-burn-build-gym',
    '6wk_home': '6week-burn-build-home',
    '12wk': '12week-flagship',
    'pcos': 'pcos-warrior',
    '40plus': '40plus-strong',
    'zoom_trial': 'zoom-trial',
    'zoom_pack': 'zoom-pack',
  };
  const id = checkoutIds[program] || program;
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${id}`;
}

function getProgramPrice(program) {
  const prices = {
    '6wk_gym': '$97',
    '6wk_home': '$97',
    '12wk': '$200',
    'pcos': '$45',
    '40plus': '$50',
    'zoom_trial': '$20',
    'zoom_pack': '$150',
  };
  return prices[program] || 'TBD';
}

module.exports = { classifyIntent, getProgramCheckoutUrl, getProgramPrice, OPT_OUT_KEYWORDS };
