function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const clean = phone.replace(/[^0-9]/g, '');
  if (clean.startsWith('91')) return 'IN';
  if (clean.startsWith('971')) return 'UAE';
  if (clean.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

const KEYWORD_MAP = {
  '6wk_gym': ['fat loss', 'weight', 'shred', 'burn', 'lean', 'cut'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
  '40plus': ['40', 'menopause', 'joints', 'joint', 'senior', '50'],
  '12wk': ['custom', '12 week', 'serious', 'personalised', 'personalized', 'flagship'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test']
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [program, keywords] of Object.entries(KEYWORD_MAP)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}

function programPrice(program) {
  const prices = {
    '6wk_gym': 97, '6wk_home': 97, 'pcos': 45, '40plus': 50,
    '12wk': 200, 'zoom_trial': 20, 'zoom_pack': 80
  };
  return prices[program] || 0;
}

function programLabel(program) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    '12wk': '12-Week Flagship Custom',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Pack (4 Sessions)'
  };
  return labels[program] || program;
}

function programWeeks(program) {
  const weeks = {
    '6wk_gym': 6, '6wk_home': 6, 'pcos': 6, '40plus': 8,
    '12wk': 12, 'zoom_trial': 1, 'zoom_pack': 4
  };
  return weeks[program] || 6;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

module.exports = {
  detectMarket, isHinglish, matchProgram, programPrice,
  programLabel, programWeeks, cors
};
