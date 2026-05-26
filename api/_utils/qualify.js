const PROGRAM_RULES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lose fat', 'slim', 'lean', 'burn'],
    program: '6wk_gym',
    label: '6-Week Burn & Build',
    price: 97,
    checkout: '6wk-burn'
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'thyroid'],
    program: 'pcos',
    label: 'PCOS Warrior Program',
    price: 45,
    checkout: 'pcos-warrior'
  },
  {
    keywords: ['40', '40+', 'menopause', 'joints', 'joint pain', 'senior', 'older'],
    program: '40plus',
    label: '40+ Strong Program',
    price: 50,
    checkout: '40plus-strong'
  },
  {
    keywords: ['custom', '12 week', '12wk', 'serious', 'personalised', 'personalized', 'flagship'],
    program: '12wk',
    label: '12-Week Custom Program',
    price: 200,
    checkout: '12wk-custom'
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'],
    program: 'zoom_trial',
    label: '$20 Zoom Trial Session',
    price: 20,
    checkout: 'zoom-trial'
  }
];

function qualifyLead(message) {
  const lower = (message || '').toLowerCase();

  for (const rule of PROGRAM_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        return {
          matched: true,
          program: rule.program,
          label: rule.label,
          price: rule.price,
          checkout: rule.checkout
        };
      }
    }
  }

  return { matched: false };
}

module.exports = { qualifyLead, PROGRAM_RULES };
