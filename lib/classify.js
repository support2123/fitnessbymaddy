const PROGRAM_MAP = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'slim', 'lose'],
    program: '6wk_gym',
    label: '6-Week Burn & Build',
    price: 45,
    checkoutSlug: '6-week-burn',
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
    program: 'pcos',
    label: 'PCOS Warrior',
    price: 45,
    checkoutSlug: 'pcos-warrior',
  },
  {
    keywords: ['40', '40+', 'menopause', 'joints', 'joint pain', 'senior', 'older'],
    program: '40plus',
    label: '40+ Strong',
    price: 50,
    checkoutSlug: '40plus-strong',
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'advanced', 'flagship', 'dedicated'],
    program: '12wk',
    label: '12-Week Flagship Program',
    price: 200,
    checkoutSlug: '12-week-flagship',
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'confused'],
    program: 'zoom_trial',
    label: '$20 Zoom Trial',
    price: 20,
    checkoutSlug: 'zoom-trial',
  },
  {
    keywords: ['home', 'no gym', 'home workout', 'bodyweight'],
    program: '6wk_home',
    label: '6-Week Home Program',
    price: 40,
    checkoutSlug: '6-week-home',
  },
];

function classifyProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  for (const entry of PROGRAM_MAP) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) return entry;
    }
  }
  return null;
}

function getCheckoutUrl(checkoutSlug) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${checkoutSlug}`;
}

module.exports = { classifyProgram, getCheckoutUrl, PROGRAM_MAP };
