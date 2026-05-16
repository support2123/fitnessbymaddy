const PROGRAM_ROUTES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'slim', 'lean', 'patla'],
    program: '6wk_gym',
    name: '6 Week Burn & Build',
    price: 97,
    checkout: '6wk-burn'
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
    program: 'pcos',
    name: 'PCOS Warrior Program',
    price: 45,
    checkout: 'pcos-warrior'
  },
  {
    keywords: ['40', 'menopause', 'joints', 'joint pain', 'senior', 'age'],
    program: '40plus',
    name: '40+ Strong Program',
    price: 50,
    checkout: '40plus-strong'
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'transform', 'full program', 'flagship'],
    program: '12wk',
    name: '12-Week Flagship Program',
    price: 200,
    checkout: '12wk-flagship'
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'pehle', 'dekh'],
    program: 'zoom_trial',
    name: 'Zoom Trial Session',
    price: 20,
    checkout: 'zoom-trial'
  }
];

function matchProgram(message) {
  const lower = message.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

function isOptOut(message) {
  const lower = message.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'band karo', 'mat bhejo'].some(
    kw => lower.includes(kw)
  );
}

module.exports = { PROGRAM_ROUTES, matchProgram, isOptOut };
