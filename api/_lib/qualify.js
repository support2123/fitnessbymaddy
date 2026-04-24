const PROGRAM_RULES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'cut', 'slim', 'lose fat', 'burn fat'],
    program: '6wk_gym',
    name: '6-Week Burn & Build',
    price: 97,
    checkout_path: 'checkout/6wk-burn'
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'irregular period', 'period'],
    program: 'pcos',
    name: 'PCOS Warrior',
    price: 45,
    checkout_path: 'checkout/pcos-warrior'
  },
  {
    keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'older', 'age'],
    program: '40plus',
    name: '40+ Strong',
    price: 50,
    checkout_path: 'checkout/40plus-strong'
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'personalised', 'personalized', 'transform'],
    program: '12wk',
    name: '12-Week Flagship',
    price: 200,
    checkout_path: 'checkout/12wk-flagship'
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'],
    program: 'zoom_trial',
    name: '$20 Zoom Trial',
    price: 20,
    checkout_path: 'checkout/zoom-trial'
  }
];

function qualifyLead(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();

  for (const rule of PROGRAM_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return rule;
    }
  }
  return null;
}

module.exports = { qualifyLead, PROGRAM_RULES };
