const PROGRAM_ROUTES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lose fat', 'slim', 'lean'],
    program: '6wk_gym',
    name: '6-Week Burn & Build',
    price: 97,
    checkoutPath: '6-week-shred'
  },
  {
    keywords: ['home', 'no gym', 'home workout', 'bodyweight'],
    program: '6wk_home',
    name: '6-Week Home Program',
    price: 97,
    checkoutPath: '6-week-home'
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular period'],
    program: 'pcos',
    name: 'PCOS Warrior Program',
    price: 45,
    checkoutPath: 'pcos-warrior'
  },
  {
    keywords: ['40', '40+', 'menopause', 'joints', 'joint pain', 'senior', 'older'],
    program: '40plus',
    name: '40+ Strong Program',
    price: 50,
    checkoutPath: '40-plus-strong'
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'full program', 'personalised', 'personalized'],
    program: '12wk',
    name: '12-Week Flagship Program',
    price: 200,
    checkoutPath: '12-week-custom'
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'],
    program: 'zoom_trial',
    name: 'Zoom Trial Session',
    price: 20,
    checkoutPath: 'zoom-trial'
  }
];

function matchProgram(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    for (const kw of route.keywords) {
      if (lower.includes(kw)) return route;
    }
  }
  return null;
}

module.exports = { PROGRAM_ROUTES, matchProgram };
