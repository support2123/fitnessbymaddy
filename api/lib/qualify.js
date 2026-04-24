const PROGRAM_RULES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'slim', 'burn'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'knee', 'senior'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'full program'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'home workout', 'bodyweight'], program: '6wk_home', label: '6-Week Home' },
];

function matchProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const rule of PROGRAM_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return rule;
    }
  }
  return null;
}

function getCheckoutUrl(program) {
  const slugs = {
    '6wk_gym': '6-week-burn-build',
    '6wk_home': '6-week-home',
    '12wk': '12-week-flagship',
    'pcos': 'pcos-warrior',
    '40plus': '40-plus-strong',
    'zoom_trial': 'zoom-trial',
    'zoom_pack': 'zoom-pack',
  };
  const slug = slugs[program] || program;
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${slug}`;
}

module.exports = { matchProgram, getCheckoutUrl, PROGRAM_RULES };
