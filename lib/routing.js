const PROGRAM_ROUTES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'slim', 'burn', 'lose fat', 'belly'],
    program: '6wk_gym',
    label: '6-Week Burn & Build',
    price: 97,
    checkoutPath: '6wk-burn-build'
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular period'],
    program: 'pcos',
    label: 'PCOS Warrior',
    price: 45,
    checkoutPath: 'pcos-warrior'
  },
  {
    keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior', 'over 40', '40+', '45', '50'],
    program: '40plus',
    label: '40+ Strong',
    price: 50,
    checkoutPath: '40plus-strong'
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'full program', 'complete', 'flagship', 'dedicated'],
    program: '12wk',
    label: '12-Week Flagship',
    price: 200,
    checkoutPath: '12wk-flagship'
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample', 'one session'],
    program: 'zoom_trial',
    label: 'Zoom Trial Session',
    price: 20,
    checkoutPath: 'zoom-trial'
  }
];

function routeByKeywords(message) {
  const lower = message.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

function getCheckoutUrl(route) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${route.checkoutPath}`;
}

function getIntakeUrl(leadId) {
  return `https://fitnessbymaddy.com/intake.html?lead=${leadId}`;
}

function getCheckinUrl(clientId, weekNo) {
  return `https://fitnessbymaddy.com/checkin.html?c=${clientId}&w=${weekNo}`;
}

module.exports = { routeByKeywords, getCheckoutUrl, getIntakeUrl, getCheckinUrl, PROGRAM_ROUTES };
