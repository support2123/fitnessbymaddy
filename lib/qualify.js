const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build', price: 97 },
  { keywords: ['home', 'no gym', 'bodyweight', 'home workout'], program: '6wk_home', name: '6-Week Home Shred', price: 97 },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', name: 'PCOS Warrior', price: 45 },
  { keywords: ['40', 'menopause', 'joints', 'joint pain', 'senior', 'age'], program: '40plus', name: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'advanced', 'personalized'], program: '12wk', name: '12-Week Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure'], program: 'zoom_trial', name: 'Zoom Trial Session', price: 20 },
];

function qualifyLead(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();

  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

function getCheckoutUrl(program) {
  const slugs = {
    '6wk_gym': '6-week-burn-build',
    '6wk_home': '6-week-home-shred',
    '12wk': '12-week-flagship',
    'pcos': 'pcos-warrior',
    '40plus': '40-plus-strong',
    'zoom_trial': 'zoom-trial',
    'zoom_pack': 'zoom-pack',
  };
  const slug = slugs[program] || program;
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${slug}`;
}

module.exports = { qualifyLead, getCheckoutUrl, PROGRAM_ROUTES };
