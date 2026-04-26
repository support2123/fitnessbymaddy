const PROGRAM_RULES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'cut', 'burn'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home', 'ghar'], program: '6wk_home', label: '6-Week Home Program' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'arthritis'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'transform', 'flagship', 'full'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'pehle', 'dekhna'], program: 'zoom_trial', label: '$20 Zoom Trial' }
];

function qualifyLead(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();

  for (const rule of PROGRAM_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return { program: rule.program, label: rule.label };
    }
  }
  return null;
}

function getCheckoutUrl(program) {
  const BASE = 'https://fitnessbymaddyy.exlyapp.com/checkout';
  const slugs = {
    '6wk_gym': '6-week-burn-build',
    '6wk_home': '6-week-home',
    'pcos': 'pcos-warrior',
    '40plus': '40-plus-strong',
    '12wk': '12-week-flagship',
    'zoom_trial': 'zoom-trial',
    'zoom_pack': 'zoom-pack'
  };
  return `${BASE}/${slugs[program] || program}`;
}

module.exports = { qualifyLead, getCheckoutUrl, PROGRAM_RULES };
