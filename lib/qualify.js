const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'lose fat', 'cut'], program: '6wk_gym', name: '6-Week Burn & Build', price: 97 },
  { keywords: ['home', 'no gym', 'bodyweight', 'home workout'], program: '6wk_home', name: '6-Week Home Burn', price: 97 },
  { keywords: ['pcos', 'hormonal', 'hormone', 'irregular period'], program: 'pcos', name: 'PCOS Warrior', price: 45 },
  { keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior'], program: '40plus', name: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', '12week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', name: '12-Week Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial', price: 20 }
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

function getProgramDuration(program) {
  switch (program) {
    case '6wk_gym':
    case '6wk_home': return 42;
    case '12wk': return 84;
    case 'pcos': return 42;
    case '40plus': return 42;
    case 'zoom_trial': return 7;
    case 'zoom_pack': return 30;
    default: return 42;
  }
}

module.exports = { qualifyLead, getProgramDuration, PROGRAM_ROUTES };
