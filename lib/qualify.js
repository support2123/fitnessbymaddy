const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'slim', 'lean', 'patla'], program: '6wk_gym', name: '6-Week Burn & Build', price: 97 },
  { keywords: ['home', 'ghar', 'no gym', 'bodyweight'], program: '6wk_home', name: '6-Week Home Shred', price: 97 },
  { keywords: ['pcos', 'hormonal', 'pcod', 'thyroid'], program: 'pcos', name: 'PCOS Warrior', price: 45 },
  { keywords: ['40', 'menopause', 'joints', 'senior', '40+', 'forty'], program: '40plus', name: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', 'serious', 'transform', 'flagship', 'full'], program: '12wk', name: '12-Week Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'pehle'], program: 'zoom_trial', name: 'Zoom Trial Session', price: 20 },
];

function qualifyLead(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();

  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

function buildCheckoutUrl(checkoutId) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${checkoutId}`;
}

function buildIntakeUrl(leadId) {
  return `https://fitnessbymaddy.com/intake.html?lead=${leadId}`;
}

module.exports = { qualifyLead, buildCheckoutUrl, buildIntakeUrl, PROGRAM_ROUTES };
