const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'lose fat', 'lean', 'burn', 'cut'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period', 'thyroid'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior', 'over 40'],
  '12wk': ['custom', '12 week', 'serious', 'flagship', 'full program', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'demo']
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  '6wk_home': '6-Week Home Burn',
  'pcos': 'PCOS Warrior',
  '40plus': '40+ Strong',
  '12wk': '12-Week Custom Flagship',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Coaching Pack'
};

const PROGRAM_PRICES = {
  '6wk_gym': 97,
  '6wk_home': 97,
  'pcos': 45,
  '40plus': 50,
  '12wk': 200,
  'zoom_trial': 20,
  'zoom_pack': 597
};

function matchProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return program;
    }
  }
  return null;
}

function getProgramName(code) {
  return PROGRAM_NAMES[code] || code;
}

function getProgramPrice(code) {
  return PROGRAM_PRICES[code] || 0;
}

function getCheckoutUrl(checkoutId) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${checkoutId}`;
}

module.exports = { matchProgram, getProgramName, getProgramPrice, getCheckoutUrl, PROGRAM_NAMES, PROGRAM_PRICES };
