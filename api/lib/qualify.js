const PROGRAM_RULES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lose fat', 'slim', 'lean'],
    program: '6wk_gym',
    label: '6-Week Burn & Build',
    price: '$97',
    checkoutPath: 'shred',
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'thyroid'],
    program: 'pcos',
    label: 'PCOS Warrior',
    price: '$45',
    checkoutPath: 'pcos',
  },
  {
    keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior', 'age'],
    program: '40plus',
    label: '40+ Strong',
    price: '$50',
    checkoutPath: '40plus',
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'personalised', 'personalized'],
    program: '12wk',
    label: '12-Week Flagship',
    price: '$200',
    checkoutPath: 'custom',
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure'],
    program: 'zoom_trial',
    label: '$20 Zoom Trial',
    price: '$20',
    checkoutPath: 'zoom-trial',
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

function buildCheckoutUrl(checkoutPath) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${checkoutPath}`;
}

function buildIntakeUrl(leadId) {
  return `https://fitnessbymaddy.com/intake.html?lead=${leadId}`;
}

module.exports = { qualifyLead, buildCheckoutUrl, buildIntakeUrl, PROGRAM_RULES };
