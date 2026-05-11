const PROGRAM_MAP = {
  '6wk_gym': {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'cut', 'fat'],
    name: '6-Week Burn & Build (Gym)',
    price: 97,
    checkoutPath: 'checkout/6wk-gym',
  },
  '6wk_home': {
    keywords: ['home', 'no gym', 'bodyweight', 'ghar pe'],
    name: '6-Week Burn & Build (Home)',
    price: 97,
    checkoutPath: 'checkout/6wk-home',
  },
  'pcos': {
    keywords: ['pcos', 'hormonal', 'hormone', 'irregular period'],
    name: 'PCOS Warrior',
    price: 45,
    checkoutPath: 'checkout/pcos',
  },
  '40plus': {
    keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'age'],
    name: '40+ Strong',
    price: 50,
    checkoutPath: 'checkout/40plus',
  },
  '12wk': {
    keywords: ['custom', '12 week', 'serious', 'full program', 'flagship', 'personalised'],
    name: '12-Week Flagship',
    price: 200,
    checkoutPath: 'checkout/12wk',
  },
  'zoom_trial': {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test'],
    name: 'Zoom Trial Session',
    price: 20,
    checkoutPath: 'checkout/zoom-trial',
  },
};

function qualifyLead(message) {
  const lower = (message || '').toLowerCase();

  for (const [programId, config] of Object.entries(PROGRAM_MAP)) {
    if (config.keywords.some(kw => lower.includes(kw))) {
      return { programId, ...config };
    }
  }

  return null;
}

function isOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

module.exports = { qualifyLead, isOptOut, PROGRAM_MAP };
