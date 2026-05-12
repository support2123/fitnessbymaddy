const PROGRAM_MAP = {
  '6wk_gym': {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'slim', 'lose weight', 'belly', 'lean'],
    name: '6-Week Burn & Build (Gym)',
    price: 97
  },
  '6wk_home': {
    keywords: ['home workout', 'no gym', 'ghar pe', 'home'],
    name: '6-Week Burn & Build (Home)',
    price: 97
  },
  'pcos': {
    keywords: ['pcos', 'pcod', 'hormonal', 'hormone', 'irregular period'],
    name: 'PCOS Warrior',
    price: 45
  },
  '40plus': {
    keywords: ['40', 'forty', '40+', 'menopause', 'joints', 'joint pain', 'age'],
    name: '40+ Strong',
    price: 50
  },
  '12wk': {
    keywords: ['custom', '12 week', '12wk', 'serious', 'personalised', 'personalized', 'flagship'],
    name: '12-Week Custom Training',
    price: 200
  },
  'zoom_trial': {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'confused'],
    name: 'Zoom Trial Session',
    price: 20
  }
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [key, program] of Object.entries(PROGRAM_MAP)) {
    for (const kw of program.keywords) {
      if (lower.includes(kw)) {
        return { key, ...program };
      }
    }
  }
  return null;
}

module.exports = { PROGRAM_MAP, matchProgram };
