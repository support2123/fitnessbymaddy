const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'cut', 'lose'], program: '6wk_gym', name: '6-Week Burn & Build', price: 97 },
  { keywords: ['pcos', 'hormonal', 'hormone', 'periods', 'irregular'], program: 'pcos', name: 'PCOS Warrior', price: 45 },
  { keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'older'], program: '40plus', name: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'full program', 'personalised', 'personalized'], program: '12wk', name: '12-Week Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure'], program: 'zoom_trial', name: 'Zoom Trial Session', price: 20 },
  { keywords: ['home', 'no gym', 'home workout', 'bodyweight'], program: '6wk_home', name: '6-Week Home Program', price: 77 }
];

function qualifyLead(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();

  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

function isOptOut(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

module.exports = { qualifyLead, isOptOut, PROGRAM_ROUTES };
