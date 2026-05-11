const PROGRAM_RULES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lose weight', 'slim'],
    program: '6wk_gym',
    label: '6-Week Burn & Build',
    price: 97,
    checkoutSlug: '6wk-burn-build'
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
    program: 'pcos',
    label: 'PCOS Warrior',
    price: 45,
    checkoutSlug: 'pcos-warrior'
  },
  {
    keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior', 'age'],
    program: '40plus',
    label: '40+ Strong',
    price: 50,
    checkoutSlug: '40plus-strong'
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'transform', 'full program'],
    program: '12wk',
    label: '12-Week Flagship',
    price: 200,
    checkoutSlug: '12wk-flagship'
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'],
    program: 'zoom_trial',
    label: '$20 Zoom Trial',
    price: 20,
    checkoutSlug: 'zoom-trial'
  }
];

function qualifyLead(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  for (const rule of PROGRAM_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return rule;
    }
  }
  return null;
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

module.exports = { qualifyLead, isOptOut, PROGRAM_RULES };
