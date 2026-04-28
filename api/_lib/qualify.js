const KEYWORD_MAP = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'lean'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'age'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'advanced', 'flagship', 'personal'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', label: '6-Week Home' },
];

function qualifyLead(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();

  for (const entry of KEYWORD_MAP) {
    if (entry.keywords.some(kw => lower.includes(kw))) {
      return { program: entry.program, label: entry.label };
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
    'zoom_pack': 'zoom-pack',
  };
  return `${base}/${slugs[program] || program}`;
}

module.exports = { qualifyLead, getCheckoutUrl, KEYWORD_MAP };
