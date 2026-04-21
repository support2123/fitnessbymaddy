const PROGRAM_ROUTES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'slim'],
    program: '6wk_gym',
    name: '6-Week Burn & Build',
    price: 35,
    checkoutPath: 'six-week-shred'
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'irregular period', 'thyroid'],
    program: 'pcos',
    name: 'PCOS Warrior',
    price: 45,
    checkoutPath: 'pcos-warrior'
  },
  {
    keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior'],
    program: '40plus',
    name: '40+ Strong',
    price: 50,
    checkoutPath: 'forty-plus-strong'
  },
  {
    keywords: ['custom', '12 week', '12-week', 'twelve', 'serious', 'premium', 'full'],
    program: '12wk',
    name: '12-Week Flagship',
    price: 200,
    checkoutPath: 'twelve-week-flagship'
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'],
    program: 'zoom_trial',
    name: 'Zoom Trial Session',
    price: 20,
    checkoutPath: 'zoom-trial'
  },
  {
    keywords: ['home', 'no gym', 'bodyweight', 'home workout'],
    program: '6wk_home',
    name: '6-Week Home Shred',
    price: 30,
    checkoutPath: 'six-week-home'
  }
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

function getCheckoutUrl(route) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${route.checkoutPath}`;
}

module.exports = { qualifyLead, getCheckoutUrl, PROGRAM_ROUTES };
