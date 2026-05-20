const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'lose fat', 'lose weight', 'slim', 'cutting'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular period'],
  '40plus': ['40', 'menopause', 'joints', 'joint pain', 'over 40', '40+', 'age'],
  '12wk': ['custom', '12 week', 'serious', 'personalised', 'personalized', 'flagship', 'best program', 'full program'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'sample']
};

function detectProgram(message) {
  const lower = (message || '').toLowerCase();

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return program;
    }
  }

  return null;
}

function getProgramName(code) {
  const names = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': '$20 Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack'
  };
  return names[code] || code;
}

function getProgramPrice(code) {
  const prices = {
    '6wk_gym': 97,
    '6wk_home': 97,
    '12wk': 200,
    'pcos': 45,
    '40plus': 50,
    'zoom_trial': 20,
    'zoom_pack': 150
  };
  return prices[code] || 0;
}

function getProgramWeeks(code) {
  const weeks = {
    '6wk_gym': 6,
    '6wk_home': 6,
    '12wk': 12,
    'pcos': 8,
    '40plus': 8,
    'zoom_trial': 1,
    'zoom_pack': 8
  };
  return weeks[code] || 6;
}

module.exports = { detectProgram, getProgramName, getProgramPrice, getProgramWeeks };
