const PROGRAMS = {
  '6wk_gym': {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'cut', 'burn', 'fat'],
    name: '6-Week Burn & Build',
    price: 97,
    checkout: 'program-6wk',
  },
  'pcos': {
    keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular period'],
    name: 'PCOS Warrior',
    price: 45,
    checkout: 'program-pcos',
  },
  '40plus': {
    keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'over 40', '40+', '50'],
    name: '40+ Strong',
    price: 50,
    checkout: 'program-40plus',
  },
  '12wk': {
    keywords: ['custom', '12 week', 'twelve week', 'serious', 'personalised', 'personalized', 'flagship'],
    name: '12-Week Flagship',
    price: 200,
    checkout: 'program-12wk',
  },
  'zoom_trial': {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'demo'],
    name: '$20 Zoom Trial',
    price: 20,
    checkout: 'program-trial',
  },
};

function matchProgram(text) {
  const lower = (text || '').toLowerCase();

  for (const [key, prog] of Object.entries(PROGRAMS)) {
    if (prog.keywords.some(kw => lower.includes(kw))) {
      return { key, ...prog };
    }
  }
  return null;
}

module.exports = { matchProgram, PROGRAMS };
