const PROGRAM_RULES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'slim', 'belly', 'pet ki charbi'],
    program: '6wk_gym',
    name: '6-Week Burn & Build',
    price: 97,
  },
  {
    keywords: ['pcos', 'pcod', 'hormonal', 'hormone', 'period', 'irregular'],
    program: 'pcos',
    name: 'PCOS Warrior Program',
    price: 45,
  },
  {
    keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'age', 'senior'],
    program: '40plus',
    name: '40+ Strong Program',
    price: 50,
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'personalised', 'personalized', 'flagship'],
    program: '12wk',
    name: '12-Week Flagship Program',
    price: 200,
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'pehle', 'confused'],
    program: 'zoom_trial',
    name: 'Zoom Trial Session',
    price: 20,
  },
];

function qualifyLead(message) {
  const lower = (message || '').toLowerCase();
  for (const rule of PROGRAM_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return rule;
    }
  }
  return null;
}

module.exports = { qualifyLead, PROGRAM_RULES };
