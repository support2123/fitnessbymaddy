const PROGRAM_ROUTES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'slim', 'lose fat', 'lose weight'],
    program: '6wk_gym',
    name: '6-Week Burn & Build',
    price: 97,
    checkout: 'shred-6week',
  },
  {
    keywords: ['home', 'home workout', 'no gym', 'bodyweight'],
    program: '6wk_home',
    name: '6-Week Home Shred',
    price: 97,
    checkout: 'home-6week',
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
    program: 'pcos',
    name: 'PCOS Warrior Program',
    price: 45,
    checkout: 'pcos-warrior',
  },
  {
    keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior', 'over 40'],
    program: '40plus',
    name: '40+ Strong Program',
    price: 50,
    checkout: '40plus-strong',
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'personalised', 'personalized', 'flagship'],
    program: '12wk',
    name: '12-Week Flagship Program',
    price: 200,
    checkout: 'flagship-12week',
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'],
    program: 'zoom_trial',
    name: '$20 Zoom Trial Session',
    price: 20,
    checkout: 'zoom-trial',
  },
];

function qualifyLead(message) {
  const lower = (message || '').toLowerCase();

  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }

  return null;
}

module.exports = { qualifyLead, PROGRAM_ROUTES };
