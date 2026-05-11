const PROGRAM_ROUTES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'slim'],
    program: '6wk_gym',
    name: '6-Week Burn & Build',
    price: 97,
    checkoutPath: 'checkout/6wk-burn-build',
  },
  {
    keywords: ['home', 'home workout', 'no gym', 'bodyweight'],
    program: '6wk_home',
    name: '6-Week Home Burn',
    price: 79,
    checkoutPath: 'checkout/6wk-home',
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
    program: 'pcos',
    name: 'PCOS Warrior',
    price: 45,
    checkoutPath: 'checkout/pcos-warrior',
  },
  {
    keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior', 'mature'],
    program: '40plus',
    name: '40+ Strong',
    price: 50,
    checkoutPath: 'checkout/40plus-strong',
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'full program', 'personalised', 'personalized'],
    program: '12wk',
    name: '12-Week Flagship',
    price: 200,
    checkoutPath: 'checkout/12wk-flagship',
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure'],
    program: 'zoom_trial',
    name: '$20 Zoom Trial',
    price: 20,
    checkoutPath: 'checkout/zoom-trial',
  },
];

function qualifyLead(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    for (const kw of route.keywords) {
      if (lower.includes(kw)) {
        return route;
      }
    }
  }
  return null;
}

module.exports = { qualifyLead, PROGRAM_ROUTES };
