const KEYWORD_MAP = [
  { keywords: ['fat loss', 'weight', 'shred', 'slim', 'lean'], program: '6wk_gym', name: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'age'], program: '40plus', name: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'transform', 'complete'], program: '12wk', name: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'], program: 'zoom_trial', name: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', name: '6-Week Home' },
];

function qualifyLead(message) {
  const lower = message.toLowerCase();
  for (const entry of KEYWORD_MAP) {
    if (entry.keywords.some(kw => lower.includes(kw))) {
      return { program: entry.program, name: entry.name };
    }
  }
  return null;
}

function getCheckoutUrl(program) {
  const base = 'https://fitnessbymaddyy.exlyapp.com/checkout';
  const slugs = {
    '6wk_gym': '6-week-burn-build',
    '6wk_home': '6-week-home',
    'pcos': 'pcos-warrior',
    '40plus': '40-plus-strong',
    '12wk': '12-week-flagship',
    'zoom_trial': 'zoom-trial',
    'zoom_pack': 'zoom-pack',
  };
  return `${base}/${slugs[program] || program}`;
}

module.exports = { qualifyLead, getCheckoutUrl };
