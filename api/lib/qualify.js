const PROGRAM_ROUTES = [
  {
    keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'burn'],
    program: '6wk_gym',
    name: '6-Week Burn & Build',
    price: 97
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
    program: 'pcos',
    name: 'PCOS Warrior',
    price: 45
  },
  {
    keywords: ['40', 'menopause', 'joints', 'joint', 'older', 'age'],
    program: '40plus',
    name: '40+ Strong',
    price: 50
  },
  {
    keywords: ['custom', '12 week', 'serious', 'transform', 'complete', 'full'],
    program: '12wk',
    name: '12-Week Flagship',
    price: 200
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'],
    program: 'zoom_trial',
    name: '$20 Zoom Trial',
    price: 20
  },
  {
    keywords: ['home', 'no gym', 'bodyweight', 'at home', 'home workout'],
    program: '6wk_home',
    name: '6-Week Home Program',
    price: 67
  }
];

function qualifyLead(message) {
  const lower = message.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

module.exports = { qualifyLead, PROGRAM_ROUTES };
