const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'cut'], program: '6wk_gym', name: '6 Week Burn & Build', price: 97 },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', name: '6 Week Home Shred', price: 97 },
  { keywords: ['pcos', 'hormonal', 'hormone', 'irregular'], program: 'pcos', name: 'PCOS Warrior', price: 45 },
  { keywords: ['40', 'menopause', 'joints', 'joint pain', 'over 40'], program: '40plus', name: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'transform', 'complete'], program: '12wk', name: '12-Week Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial Session', price: 20 }
];

function qualifyLead(message) {
  const lower = (message || '').toLowerCase();

  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }

  return null;
}

module.exports = { qualifyLead, PROGRAM_ROUTES };
