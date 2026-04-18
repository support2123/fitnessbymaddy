const PROGRAM_RULES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'cut'],
    program: '6wk_gym',
    name: '6-Week Burn & Build',
    price: 97,
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'thyroid'],
    program: 'pcos',
    name: 'PCOS Warrior',
    price: 45,
  },
  {
    keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior', 'age'],
    program: '40plus',
    name: '40+ Strong',
    price: 50,
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'full', 'complete', 'flagship'],
    program: '12wk',
    name: '12-Week Flagship',
    price: 200,
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure'],
    program: 'zoom_trial',
    name: '$20 Zoom Trial',
    price: 20,
  },
];

function qualifyLead(message) {
  const lower = (message || '').toLowerCase();
  for (const rule of PROGRAM_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return rule;
    }
  }
  return null;
}

module.exports = { qualifyLead, PROGRAM_RULES };
