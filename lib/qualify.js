const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'cut'], program: '6wk_gym', name: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint pain', '40+', 'forty'], program: '40plus', name: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised'], program: '12wk', name: '12-Week Custom Training' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial Session' },
  { keywords: ['home', 'no gym', 'bodyweight', 'home workout'], program: '6wk_home', name: '6-Week Home Program' },
];

function matchProgram(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    for (const kw of route.keywords) {
      if (lower.includes(kw)) return route;
    }
  }
  return null;
}

function getCheckoutUrl(program) {
  const slugs = {
    '6wk_gym': '6-week-burn-build',
    '6wk_home': '6-week-home',
    '12wk': '12-week-custom',
    'pcos': 'pcos-warrior',
    '40plus': '40-plus-strong',
    'zoom_trial': 'zoom-trial',
    'zoom_pack': 'zoom-pack',
  };
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${slugs[program] || program}`;
}

module.exports = { matchProgram, getCheckoutUrl, PROGRAM_ROUTES };
