const PROGRAM_RULES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'cut', 'slim'],
    program: '6wk_gym',
    name: '6-Week Burn & Build',
    price: 97,
    checkoutSlug: '6-week-shred'
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
    program: 'pcos',
    name: 'PCOS Warrior',
    price: 45,
    checkoutSlug: 'pcos-warrior'
  },
  {
    keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'mature', 'senior'],
    program: '40plus',
    name: '40+ Strong',
    price: 50,
    checkoutSlug: '40-plus-strong'
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'transform', 'flagship', 'personalised', 'personalized'],
    program: '12wk',
    name: '12-Week Flagship',
    price: 200,
    checkoutSlug: '12-week-custom'
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure'],
    program: 'zoom_trial',
    name: 'Zoom Trial Session',
    price: 20,
    checkoutSlug: 'zoom-trial'
  },
  {
    keywords: ['home', 'no gym', 'bodyweight', 'home workout'],
    program: '6wk_home',
    name: '6-Week Home Shred',
    price: 97,
    checkoutSlug: '6-week-home'
  }
];

function qualifyLead(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  for (const rule of PROGRAM_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return rule;
    }
  }

  return null;
}

module.exports = { qualifyLead, PROGRAM_RULES };
