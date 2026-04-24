const PROGRAM_MAP = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'slim', 'lose fat', 'belly'],
    program: '6wk_gym',
    name: '6-Week Burn & Build',
    price: 97,
    checkout: 'shred-challenge'
  },
  {
    keywords: ['pcos', 'pcod', 'hormonal', 'hormone', 'irregular period', 'thyroid'],
    program: 'pcos',
    name: 'PCOS Warrior',
    price: 45,
    checkout: 'pcos-warrior'
  },
  {
    keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'mature', 'senior'],
    program: '40plus',
    name: '40+ Strong',
    price: 50,
    checkout: '40-plus-strong'
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'advanced', 'flagship', 'personal', 'dedicated'],
    program: '12wk',
    name: '12-Week Flagship',
    price: 200,
    checkout: '12-week-flagship'
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'demo', 'sample'],
    program: 'zoom_trial',
    name: '$20 Zoom Trial',
    price: 20,
    checkout: 'zoom-trial'
  },
  {
    keywords: ['home', 'no gym', 'bodyweight', 'at home', 'ghar pe', 'ghar', 'no equipment'],
    program: '6wk_home',
    name: '6-Week Home Program',
    price: 67,
    checkout: '6wk-home'
  }
];

function qualifyLead(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();

  for (const entry of PROGRAM_MAP) {
    if (entry.keywords.some(kw => lower.includes(kw))) {
      return entry;
    }
  }
  return null;
}

function getCheckoutUrl(checkoutSlug) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${checkoutSlug}`;
}

function getIntakeUrl(leadId) {
  return `https://fitnessbymaddy.com/intake.html?lead=${leadId}`;
}

module.exports = { qualifyLead, getCheckoutUrl, getIntakeUrl, PROGRAM_MAP };
