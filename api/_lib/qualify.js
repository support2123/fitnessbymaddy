const PROGRAM_RULES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lose weight', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'thyroid'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', '40+', 'menopause', 'joints', 'joint pain', 'over 40', 'senior'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'full program', 'personalised'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keywords: ['home', 'home workout', 'no gym', 'bodyweight'], program: '6wk_home', label: '6-Week Home Program' }
];

function qualifyLead(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();

  for (const rule of PROGRAM_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        return { program: rule.program, label: rule.label };
      }
    }
  }
  return null;
}

function getCheckoutUrl(program) {
  const base = 'https://fitnessbymaddyy.exlyapp.com/checkout';
  const slugs = {
    '6wk_gym': '6-week-burn-build',
    '6wk_home': '6-week-home',
    '12wk': '12-week-flagship',
    'pcos': 'pcos-warrior',
    '40plus': '40-plus-strong',
    'zoom_trial': 'zoom-trial',
    'zoom_pack': 'zoom-pack'
  };
  return `${base}/${slugs[program] || program}`;
}

function getProgramPrice(program) {
  const prices = {
    '6wk_gym': '$45',
    '6wk_home': '$45',
    '12wk': '$200',
    'pcos': '$45',
    '40plus': '$50',
    'zoom_trial': '$20',
    'zoom_pack': '$80'
  };
  return prices[program] || '$45';
}

module.exports = { qualifyLead, getCheckoutUrl, getProgramPrice, PROGRAM_RULES };
