const PROGRAM_ROUTES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'slim', 'burn', 'lose'],
    program: '6wk_gym',
    name: '6-Week Burn & Build',
    price: '$97',
    checkoutPath: 'checkout/6wk-burn'
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular period'],
    program: 'pcos',
    name: 'PCOS Warrior',
    price: '$45',
    checkoutPath: 'checkout/pcos-warrior'
  },
  {
    keywords: ['40', '40+', 'menopause', 'joints', 'joint pain', 'senior', 'mature'],
    program: '40plus',
    name: '40+ Strong',
    price: '$50',
    checkoutPath: 'checkout/40plus-strong'
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'personalised', 'personalized', 'full'],
    program: '12wk',
    name: '12-Week Flagship',
    price: '$200',
    checkoutPath: 'checkout/12wk-flagship'
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'],
    program: 'zoom_trial',
    name: 'Zoom Trial Session',
    price: '$20',
    checkoutPath: 'checkout/zoom-trial'
  }
];

function matchProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

module.exports = { matchProgram, PROGRAM_ROUTES };
