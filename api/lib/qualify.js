const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build', price: 35 },
  { keywords: ['home', 'no gym', 'bodyweight', 'home workout'], program: '6wk_home', name: '6-Week Home Shred', price: 30 },
  { keywords: ['pcos', 'hormonal', 'hormone', 'irregular period'], program: 'pcos', name: 'PCOS Warrior', price: 45 },
  { keywords: ['40', '40+', 'menopause', 'joints', 'joint pain', 'senior'], program: '40plus', name: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'advanced', 'compete'], program: '12wk', name: '12-Week Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial Session', price: 20 }
];

function qualifyLead(messageText) {
  const lower = messageText.toLowerCase();

  for (const route of PROGRAM_ROUTES) {
    for (const keyword of route.keywords) {
      if (lower.includes(keyword)) {
        return route;
      }
    }
  }

  return null;
}

function getCheckoutUrl(program) {
  const BASE = 'https://fitnessbymaddyy.exlyapp.com/checkout';
  const slugs = {
    '6wk_gym': '6-week-burn-build',
    '6wk_home': '6-week-home-shred',
    '12wk': '12-week-flagship',
    'pcos': 'pcos-warrior',
    '40plus': '40-plus-strong',
    'zoom_trial': 'zoom-trial',
    'zoom_pack': 'zoom-pack'
  };
  return `${BASE}/${slugs[program] || program}`;
}

function getIntakeFormUrl(leadId) {
  return `https://fitnessbymaddy.com/intake.html?lead=${leadId}`;
}

module.exports = { qualifyLead, getCheckoutUrl, getIntakeFormUrl, PROGRAM_ROUTES };
