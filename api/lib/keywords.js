const PROGRAM_MAP = {
  '6wk_gym': {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'lose fat', 'slim'],
    name: '6-Week Burn & Build (Gym)',
    price: 35,
    checkoutSlug: '6-week-shred',
  },
  '6wk_home': {
    keywords: ['home', 'no gym', 'at home', 'home workout'],
    name: '6-Week Burn & Build (Home)',
    price: 30,
    checkoutSlug: '6-week-home',
  },
  'pcos': {
    keywords: ['pcos', 'hormonal', 'hormone', 'irregular period', 'thyroid'],
    name: 'PCOS Warrior',
    price: 45,
    checkoutSlug: 'pcos-warrior',
  },
  '40plus': {
    keywords: ['40', 'menopause', 'joints', 'joint pain', 'over 40', '40+', 'older'],
    name: '40+ Strong',
    price: 50,
    checkoutSlug: '40-plus-strong',
  },
  '12wk': {
    keywords: ['custom', '12 week', '12wk', 'serious', 'advanced', 'flagship', 'personalized'],
    name: '12-Week Flagship',
    price: 200,
    checkoutSlug: '12-week-flagship',
  },
  'zoom_trial': {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'],
    name: 'Zoom Trial Session',
    price: 20,
    checkoutSlug: 'program-trial',
  },
};

function matchProgram(message) {
  const lower = message.toLowerCase();
  for (const [key, prog] of Object.entries(PROGRAM_MAP)) {
    for (const kw of prog.keywords) {
      if (lower.includes(kw)) return { programKey: key, ...prog };
    }
  }
  return null;
}

module.exports = { PROGRAM_MAP, matchProgram };
