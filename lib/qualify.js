const PROGRAM_RULES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'slim', 'lose'],
    program: '6wk_gym',
    label: '6-Week Burn & Build',
    price: 97
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
    program: 'pcos',
    label: 'PCOS Warrior Program',
    price: 45
  },
  {
    keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'mature', 'senior'],
    program: '40plus',
    label: '40+ Strong Program',
    price: 50
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'dedicated', 'flagship', 'personalised', 'personalized'],
    program: '12wk',
    label: '12-Week Flagship Program',
    price: 200
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure'],
    program: 'zoom_trial',
    label: '$20 Zoom Trial Session',
    price: 20
  },
  {
    keywords: ['home', 'no gym', 'bodyweight', 'home workout'],
    program: '6wk_home',
    label: '6-Week Home Shred',
    price: 77
  }
];

function qualifyLead(messageText) {
  const lower = (messageText || '').toLowerCase();

  for (const rule of PROGRAM_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return {
        program: rule.program,
        label: rule.label,
        price: rule.price
      };
    }
  }
  return null;
}

function getCheckoutUrl(program) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
}

function getIntakeUrl(leadId) {
  return `https://fitnessbymaddy.com/intake?lead=${leadId}`;
}

module.exports = { qualifyLead, getCheckoutUrl, getIntakeUrl, PROGRAM_RULES };
