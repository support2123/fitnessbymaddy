const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build', price: 97 },
  { keywords: ['home', 'no gym', 'bodyweight', 'home workout'], program: '6wk_home', label: '6-Week Home Burn', price: 97 },
  { keywords: ['pcos', 'hormonal', 'hormone', 'thyroid', 'irregular period'], program: 'pcos', label: 'PCOS Warrior', price: 45 },
  { keywords: ['40', '40+', 'menopause', 'joints', 'joint pain', 'senior'], program: '40plus', label: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'advanced', 'flagship', 'transform'], program: '12wk', label: '12-Week Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure'], program: 'zoom_trial', label: 'Zoom Trial Session', price: 20 },
];

function qualifyLead(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some((kw) => lower.includes(kw))) {
      return route;
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

module.exports = { qualifyLead, getCheckoutUrl, getIntakeUrl, PROGRAM_ROUTES };
