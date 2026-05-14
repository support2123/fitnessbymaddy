const PROGRAM_MAP = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'lean'], program: '6wk_gym', name: '6-Week Burn & Build', price: 97 },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', name: 'PCOS Warrior', price: 45 },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'mature'], program: '40plus', name: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', 'serious', 'transform', 'flagship', 'personalised', 'personalized'], program: '12wk', name: '12-Week Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'], program: 'zoom_trial', name: 'Zoom Trial Session', price: 20 },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', name: '6-Week Home Burn', price: 79 },
];

function routeToProgram(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();
  for (const entry of PROGRAM_MAP) {
    if (entry.keywords.some(kw => lower.includes(kw))) {
      return entry;
    }
  }
  return null;
}

function getCheckoutUrl(checkoutId) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${checkoutId}`;
}

function getIntakeUrl(leadId) {
  return `https://www.fitnessbymaddy.com/intake?lead=${leadId}`;
}

module.exports = { routeToProgram, getCheckoutUrl, getIntakeUrl, PROGRAM_MAP };
