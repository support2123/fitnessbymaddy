const PROGRAM_MAP = {
  '6wk_gym': {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'lean', 'fat'],
    name: '6-Week Burn & Build (Gym)',
    price: 35,
    checkoutSlug: 'burn-build-gym'
  },
  '6wk_home': {
    keywords: ['home', 'no gym', 'bodyweight', 'home workout'],
    name: '6-Week Burn & Build (Home)',
    price: 35,
    checkoutSlug: 'burn-build-home'
  },
  'pcos': {
    keywords: ['pcos', 'hormonal', 'hormone', 'irregular period'],
    name: 'PCOS Warrior',
    price: 45,
    checkoutSlug: 'pcos-warrior'
  },
  '40plus': {
    keywords: ['40', 'menopause', 'joints', 'joint pain', 'senior', 'over 40'],
    name: '40+ Strong',
    price: 50,
    checkoutSlug: '40-plus-strong'
  },
  '12wk': {
    keywords: ['custom', '12 week', 'serious', 'transform', 'flagship', 'full'],
    name: '12-Week Flagship Program',
    price: 200,
    checkoutSlug: '12-week-flagship'
  },
  'zoom_trial': {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test'],
    name: '$20 Zoom Trial',
    price: 20,
    checkoutSlug: 'zoom-trial'
  }
};

function qualifyLead(message) {
  const lower = message.toLowerCase();

  for (const [programKey, config] of Object.entries(PROGRAM_MAP)) {
    for (const keyword of config.keywords) {
      if (lower.includes(keyword)) {
        return { programKey, ...config };
      }
    }
  }

  return null;
}

function getCheckoutUrl(programKey) {
  const program = PROGRAM_MAP[programKey];
  if (!program) return null;
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${program.checkoutSlug}`;
}

function getIntakeUrl(leadId) {
  return `https://fitnessbymaddy.com/intake?lead=${leadId}`;
}

module.exports = { qualifyLead, getCheckoutUrl, getIntakeUrl, PROGRAM_MAP };
