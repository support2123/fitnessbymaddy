const ROUTES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'slim', 'belly'],
    program: '6wk_gym',
    label: '6-Week Burn & Build',
    price: '$35',
  },
  {
    keywords: ['home', 'no gym', 'bodyweight', 'ghar pe', 'home workout'],
    program: '6wk_home',
    label: '6-Week Home Program',
    price: '$35',
  },
  {
    keywords: ['pcos', 'hormonal', 'thyroid', 'pcod', 'irregular period'],
    program: 'pcos',
    label: 'PCOS Warrior Program',
    price: '$45',
  },
  {
    keywords: ['40', 'forty', 'menopause', 'joints', 'senior', '40+', '50+', 'age'],
    program: '40plus',
    label: '40+ Strong Program',
    price: '$50',
  },
  {
    keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'advanced', 'personalised', 'personalized'],
    program: '12wk',
    label: '12-Week Flagship Program',
    price: '$200',
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'],
    program: 'zoom_trial',
    label: 'Zoom Trial Session',
    price: '$20',
  },
];

function qualifyLead(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const route of ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

module.exports = { qualifyLead, ROUTES };
