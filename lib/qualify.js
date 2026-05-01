const ROUTES = [
  {
    keywords: ['fat loss', 'weight', 'shred', 'lean', 'slim', 'lose'],
    program: '6wk_gym',
    label: '6-Week Burn & Build',
    price: 97,
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
    program: 'pcos',
    label: 'PCOS Warrior',
    price: 45,
  },
  {
    keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'older'],
    program: '40plus',
    label: '40+ Strong',
    price: 50,
  },
  {
    keywords: ['custom', '12 week', 'serious', 'flagship', 'full program', 'personalised', 'personalized'],
    program: '12wk',
    label: '12-Week Flagship',
    price: 200,
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'check'],
    program: 'zoom_trial',
    label: '$20 Zoom Trial',
    price: 20,
  },
  {
    keywords: ['home', 'no gym', 'bodyweight', 'at home'],
    program: '6wk_home',
    label: '6-Week Home Program',
    price: 79,
  },
];

function qualifyLead(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  for (const route of ROUTES) {
    if (route.keywords.some((kw) => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

module.exports = { qualifyLead, ROUTES };
