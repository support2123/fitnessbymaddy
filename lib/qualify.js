const PROGRAM_RULES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lose weight', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build', price: 97 },
  { keywords: ['pcos', 'hormonal', 'hormone', 'periods', 'irregular'], program: 'pcos', name: 'PCOS Warrior', price: 45 },
  { keywords: ['40', 'menopause', 'joints', 'joint pain', 'senior', 'age'], program: '40plus', name: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', 'serious', 'transform', 'dedicated', 'flagship'], program: '12wk', name: '12-Week Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure'], program: 'zoom_trial', name: 'Zoom Trial Session', price: 20 },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', name: '6-Week Home Burn', price: 97 }
];

function qualifyLead(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const rule of PROGRAM_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return rule;
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

module.exports = { qualifyLead, getCheckoutUrl, getIntakeUrl, PROGRAM_RULES };
