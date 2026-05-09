const PROGRAM_ROUTES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lose weight', 'slim'],
    program: '6wk_gym',
    label: '6-Week Burn & Build',
    price: 97,
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'irregular period', 'pcod'],
    program: 'pcos',
    label: 'PCOS Warrior',
    price: 45,
  },
  {
    keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'over 40', '40+', 'aging'],
    program: '40plus',
    label: '40+ Strong',
    price: 50,
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'personalised', 'personalized'],
    program: '12wk',
    label: '12-Week Flagship',
    price: 200,
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure'],
    program: 'zoom_trial',
    label: '$20 Zoom Trial',
    price: 20,
  },
  {
    keywords: ['home', 'home workout', 'no gym', 'bodyweight'],
    program: '6wk_home',
    label: '6-Week Home Program',
    price: 97,
  },
];

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

module.exports = { matchProgram, PROGRAM_ROUTES };
