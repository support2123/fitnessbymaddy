const ROUTES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'cut', 'slim'],
    program: '6wk_gym',
    label: '6-Week Burn & Build',
    price: 97
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular period'],
    program: 'pcos',
    label: 'PCOS Warrior Program',
    price: 45
  },
  {
    keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior'],
    program: '40plus',
    label: '40+ Strong Program',
    price: 50
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'personalised', 'personalized'],
    program: '12wk',
    label: '12-Week Custom Program',
    price: 200
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test'],
    program: 'zoom_trial',
    label: '$20 Zoom Trial Session',
    price: 20
  },
  {
    keywords: ['home', 'no gym', 'bodyweight', 'at home', 'home workout'],
    program: '6wk_home',
    label: '6-Week Home Burn',
    price: 77
  }
];

function qualifyLead(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();

  for (const route of ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

module.exports = { qualifyLead, ROUTES };
