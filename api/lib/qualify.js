const RULES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lean', 'slim', 'lose'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'knee'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'transform', 'full'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', label: '6-Week Home' },
];

function qualifyLead(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        return { program: rule.program, label: rule.label };
      }
    }
  }

  return null;
}

function getCheckoutUrl(program) {
  const slugs = {
    '6wk_gym': '6-week-burn-and-build',
    '6wk_home': '6-week-home',
    'pcos': 'pcos-warrior',
    '40plus': '40-plus-strong',
    '12wk': '12-week-custom',
    'zoom_trial': 'zoom-trial',
    'zoom_pack': 'zoom-pack',
  };
  const slug = slugs[program] || program;
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${slug}`;
}

module.exports = { qualifyLead, getCheckoutUrl };
