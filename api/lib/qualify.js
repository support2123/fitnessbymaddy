const PROGRAM_RULES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'slim', 'burn', 'lose fat'], program: '6wk_gym', name: '6-Week Burn & Build', price: 97 },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', name: 'PCOS Warrior', price: 45 },
  { keywords: ['40+', '40 plus', '40plus', 'menopause', 'joints', 'joint pain', 'over 40', 'senior'], program: '40plus', name: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised', 'personalized', 'full program'], program: '12wk', name: '12-Week Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'], program: 'zoom_trial', name: 'Zoom Trial', price: 20 },
  { keywords: ['home', 'home workout', 'no gym', 'bodyweight'], program: '6wk_home', name: '6-Week Home Burn', price: 97 }
];

function qualifyLead(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();
  for (const rule of PROGRAM_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return rule;
    }
  }
  return null;
}

module.exports = { qualifyLead, PROGRAM_RULES };
