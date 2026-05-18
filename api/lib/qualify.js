const PROGRAM_MAP = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'slim', 'burn'], program: '6wk_gym', name: '6-Week Burn & Build' },
  { keywords: ['home', 'no gym', 'home workout', 'bodyweight'], program: '6wk_home', name: '6-Week Home Program' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', name: 'PCOS Warrior' },
  { keywords: ['40', '40+', 'menopause', 'joints', 'joint pain', 'senior'], program: '40plus', name: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'personalised', 'personalized', 'flagship'], program: '12wk', name: '12-Week Custom Training' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial Session' }
];

function qualifyLead(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();
  for (const entry of PROGRAM_MAP) {
    if (entry.keywords.some(kw => lower.includes(kw))) {
      return { program: entry.program, programName: entry.name };
    }
  }
  return null;
}

function getCheckoutUrl(program) {
  const urls = {
    '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn',
    '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
    'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
    '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
    '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
    'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
    'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
  };
  return urls[program] || urls['zoom_trial'];
}

function getProgramDurationWeeks(program) {
  const durations = {
    '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
    'pcos': 6, '40plus': 6, 'zoom_trial': 1, 'zoom_pack': 4
  };
  return durations[program] || 6;
}

module.exports = { qualifyLead, getCheckoutUrl, getProgramDurationWeeks, PROGRAM_MAP };
