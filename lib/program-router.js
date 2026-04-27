const PROGRAM_ROUTES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'fat'],
    program: '6wk_gym',
    name: '6-Week Burn & Build',
    price: 97,
    checkout: '6wk-burn-build'
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
    program: 'pcos',
    name: 'PCOS Warrior',
    price: 45,
    checkout: 'pcos-warrior'
  },
  {
    keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'older', 'age'],
    program: '40plus',
    name: '40+ Strong',
    price: 50,
    checkout: '40plus-strong'
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'personalised', 'personalized', 'flagship'],
    program: '12wk',
    name: '12-Week Flagship',
    price: 200,
    checkout: '12wk-flagship'
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure'],
    program: 'zoom_trial',
    name: '$20 Zoom Trial',
    price: 20,
    checkout: 'zoom-trial'
  },
  {
    keywords: ['home', 'no gym', 'bodyweight', 'at home'],
    program: '6wk_home',
    name: '6-Week Home Program',
    price: 97,
    checkout: '6wk-home'
  }
];

function routeToProgram(text) {
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

module.exports = { routeToProgram, PROGRAM_ROUTES };
