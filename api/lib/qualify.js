const ROUTING_RULES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'cut', 'burn', 'slim'],
    program: '6wk_gym',
    label: '6-Week Burn & Build',
    price: '$45',
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'thyroid'],
    program: 'pcos',
    label: 'PCOS Warrior Program',
    price: '$45',
  },
  {
    keywords: ['40', '40+', 'menopause', 'joints', 'joint pain', 'senior', 'age'],
    program: '40plus',
    label: '40+ Strong Program',
    price: '$50',
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'personalised', 'personalized', 'advanced'],
    program: '12wk',
    label: '12-Week Flagship Program',
    price: '$200',
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'],
    program: 'zoom_trial',
    label: '$20 Zoom Trial Session',
    price: '$20',
  },
  {
    keywords: ['home', 'no gym', 'bodyweight', 'home workout'],
    program: '6wk_home',
    label: '6-Week Home Burn',
    price: '$40',
  },
];

function qualifyLead(message) {
  const lower = (message || '').toLowerCase();
  for (const rule of ROUTING_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        return rule;
      }
    }
  }
  return null;
}

module.exports = { qualifyLead, ROUTING_RULES };
