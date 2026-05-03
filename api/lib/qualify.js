const PROGRAM_MAP = {
  '6wk_gym': {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'fat', 'slim'],
    name: '6-Week Burn & Build (Gym)',
    price: 97,
    checkout: '6wk-gym'
  },
  '6wk_home': {
    keywords: ['home', 'no gym', 'bodyweight', 'at home'],
    name: '6-Week Burn & Build (Home)',
    price: 97,
    checkout: '6wk-home'
  },
  'pcos': {
    keywords: ['pcos', 'hormonal', 'hormone', 'irregular period', 'thyroid'],
    name: 'PCOS Warrior Program',
    price: 45,
    checkout: 'pcos'
  },
  '40plus': {
    keywords: ['40', 'menopause', 'joints', 'joint pain', 'senior', 'age'],
    name: '40+ Strong Program',
    price: 50,
    checkout: '40plus'
  },
  '12wk': {
    keywords: ['custom', '12 week', '12week', 'serious', 'transform', 'full program', 'complete'],
    name: '12-Week Flagship Program',
    price: 200,
    checkout: '12wk-flagship'
  },
  'zoom_trial': {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'demo'],
    name: 'Zoom Trial Session',
    price: 20,
    checkout: 'zoom-trial'
  }
};

function qualifyLead(message) {
  const lower = (message || '').toLowerCase();

  for (const [programId, config] of Object.entries(PROGRAM_MAP)) {
    for (const keyword of config.keywords) {
      if (lower.includes(keyword)) {
        return { programId, ...config };
      }
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
