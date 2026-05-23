const PROGRAM_ROUTES = {
  '6wk_gym': {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lose weight', 'burn'],
    name: '6-Week Burn & Build (Gym)',
    price: 97,
    checkoutPath: 'shred-gym'
  },
  '6wk_home': {
    keywords: ['home', 'no gym', 'home workout'],
    name: '6-Week Burn & Build (Home)',
    price: 97,
    checkoutPath: 'shred-home'
  },
  'pcos': {
    keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular period'],
    name: 'PCOS Warrior Program',
    price: 45,
    checkoutPath: 'pcos'
  },
  '40plus': {
    keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior', 'older'],
    name: '40+ Strong Program',
    price: 50,
    checkoutPath: '40plus'
  },
  '12wk': {
    keywords: ['custom', '12 week', 'twelve week', 'serious', 'personalised', 'personalized', 'flagship'],
    name: '12-Week Flagship Program',
    price: 200,
    checkoutPath: 'custom-12wk'
  },
  'zoom_trial': {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'demo'],
    name: '$20 Zoom Trial Session',
    price: 20,
    checkoutPath: 'zoom-trial'
  }
};

function matchProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const [key, route] of Object.entries(PROGRAM_ROUTES)) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return { program: key, ...route };
    }
  }
  return null;
}

function getCheckoutUrl(checkoutPath) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${checkoutPath}`;
}

function getIntakeUrl(leadId) {
  return `https://fitnessbymaddy.com/intake.html?lead=${leadId}`;
}

module.exports = { PROGRAM_ROUTES, matchProgram, getCheckoutUrl, getIntakeUrl };
