const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'lose fat', 'slim', 'lean'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period', 'thyroid'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior', 'over 40'],
  '12wk': ['custom', '12 week', 'twelve week', 'serious', 'personalised', 'personalized', 'flagship', 'full program'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'demo', 'sample']
};

const CHECKOUT_URLS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-shred',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Custom Flagship',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Session Pack'
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return program;
    }
  }
  return null;
}

function getCheckoutUrl(program) {
  return CHECKOUT_URLS[program] || null;
}

function getProgramName(program) {
  return PROGRAM_NAMES[program] || program;
}

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel messages'];

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(kw => lower.includes(kw));
}

module.exports = { matchProgram, getCheckoutUrl, getProgramName, isOptOut };
