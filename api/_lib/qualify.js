const PROGRAM_RULES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lose fat', 'slim', 'lean'],
    program: '6wk_gym',
    label: '6-Week Burn & Build',
    price: 97,
    checkoutSlug: 'checkout/6wk-burn-build',
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular period'],
    program: 'pcos',
    label: 'PCOS Warrior',
    price: 45,
    checkoutSlug: 'checkout/pcos-warrior',
  },
  {
    keywords: ['40', '40+', 'forty', 'menopause', 'joints', 'joint pain', 'senior'],
    program: '40plus',
    label: '40+ Strong',
    price: 50,
    checkoutSlug: 'checkout/40plus-strong',
  },
  {
    keywords: ['custom', '12 week', '12week', 'serious', 'flagship', 'personalised', 'personalized'],
    program: '12wk',
    label: '12-Week Flagship',
    price: 200,
    checkoutSlug: 'checkout/12wk-flagship',
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'],
    program: 'zoom_trial',
    label: '$20 Zoom Trial',
    price: 20,
    checkoutSlug: 'checkout/zoom-trial',
  },
];

function qualifyLead(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const rule of PROGRAM_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        return rule;
      }
    }
  }
  return null;
}

module.exports = { qualifyLead, PROGRAM_RULES };
