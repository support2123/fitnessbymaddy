const PROGRAM_RULES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lose fat', 'slim', 'lean'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['home', 'no gym', 'ghar pe', 'home workout'], program: '6wk_home', label: '6-Week Home Program' },
  { keywords: ['pcos', 'hormonal', 'pcod', 'irregular period'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', '40+', 'menopause', 'joints', 'joint pain', 'aging'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'pehle try', 'demo'], program: 'zoom_trial', label: 'Zoom Trial' },
];

function qualifyLead(message) {
  const lower = (message || '').toLowerCase();
  for (const rule of PROGRAM_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return { program: rule.program, label: rule.label };
    }
  }
  return null;
}

function getCheckoutUrl(program) {
  const urls = {
    '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-shred',
    '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
    'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
    '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
    '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
    'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
    'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack',
  };
  return urls[program] || urls['zoom_trial'];
}

function getProgramPrice(program) {
  const prices = {
    '6wk_gym': 97,
    '6wk_home': 97,
    'pcos': 45,
    '40plus': 50,
    '12wk': 200,
    'zoom_trial': 20,
    'zoom_pack': 120,
  };
  return prices[program] || 0;
}

function getProgramDurationWeeks(program) {
  const durations = {
    '6wk_gym': 6,
    '6wk_home': 6,
    'pcos': 6,
    '40plus': 6,
    '12wk': 12,
    'zoom_trial': 1,
    'zoom_pack': 8,
  };
  return durations[program] || 6;
}

module.exports = { qualifyLead, getCheckoutUrl, getProgramPrice, getProgramDurationWeeks };
