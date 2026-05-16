const ROUTES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lose weight', 'slim', 'belly'],
    program: '6wk_gym',
    name: '6-Week Burn & Build',
    price: 97
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'thyroid'],
    program: 'pcos',
    name: 'PCOS Warrior Program',
    price: 45
  },
  {
    keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'aging', 'ageing'],
    program: '40plus',
    name: '40+ Strong Program',
    price: 50
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'transform', 'full program', 'flagship'],
    program: '12wk',
    name: '12-Week Custom Training',
    price: 200
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'],
    program: 'zoom_trial',
    name: 'Zoom Trial Session',
    price: 20
  },
  {
    keywords: ['home', 'home workout', 'no gym', 'bodyweight'],
    program: '6wk_home',
    name: '6-Week Home Program',
    price: 79
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

function getCheckoutUrl(program) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
}

function getIntakeUrl(leadId) {
  return `https://fitnessbymaddy.com/intake?lead=${leadId}`;
}

module.exports = { qualifyLead, getCheckoutUrl, getIntakeUrl, ROUTES };
