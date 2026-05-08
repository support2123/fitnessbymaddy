const PROGRAM_MAP = {
  '6wk_gym': {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'lean', 'cut', 'slim'],
    name: '6-Week Burn & Build (Gym)',
    price: 97,
    checkoutSlug: '6wk-burn-build'
  },
  '6wk_home': {
    keywords: ['home', 'no gym', 'home workout', 'bodyweight'],
    name: '6-Week Burn & Build (Home)',
    price: 97,
    checkoutSlug: '6wk-burn-build-home'
  },
  pcos: {
    keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
    name: 'PCOS Warrior',
    price: 45,
    checkoutSlug: 'pcos-warrior'
  },
  '40plus': {
    keywords: ['40', 'menopause', 'joints', 'joint pain', 'older', 'age'],
    name: '40+ Strong',
    price: 50,
    checkoutSlug: '40plus-strong'
  },
  '12wk': {
    keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised', 'personalized', 'full program'],
    name: '12-Week Flagship',
    price: 200,
    checkoutSlug: '12wk-flagship'
  },
  zoom_trial: {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'],
    name: 'Zoom Trial Session',
    price: 20,
    checkoutSlug: 'zoom-trial'
  }
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  for (const [key, config] of Object.entries(PROGRAM_MAP)) {
    if (config.keywords.some(kw => lower.includes(kw))) {
      return { program: key, ...config };
    }
  }
  return null;
}

module.exports = { PROGRAM_MAP, matchProgram };
