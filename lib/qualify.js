const PROGRAM_RULES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'slim', 'lose fat', 'burn fat'],
    program: '6wk_gym',
    label: '6-Week Burn & Build',
    price: 97
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
    program: 'pcos',
    label: 'PCOS Warrior',
    price: 45
  },
  {
    keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'older', 'senior'],
    program: '40plus',
    label: '40+ Strong',
    price: 50
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'personalised', 'personalized', 'flagship'],
    program: '12wk',
    label: '12-Week Flagship',
    price: 200
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'demo'],
    program: 'zoom_trial',
    label: '$20 Zoom Trial',
    price: 20
  },
  {
    keywords: ['home', 'home workout', 'no gym', 'bodyweight'],
    program: '6wk_home',
    label: '6-Week Home Program',
    price: 75
  }
];

function qualifyLead(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();
  for (const rule of PROGRAM_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return rule;
    }
  }
  return null;
}

module.exports = { qualifyLead, PROGRAM_RULES };
