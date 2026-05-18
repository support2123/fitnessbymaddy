const ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'cut'], program: '6wk_gym', name: '6-Week Burn & Build (Gym)', price: 35 },
  { keywords: ['home', 'no gym', 'home workout', 'bodyweight'], program: '6wk_home', name: '6-Week Burn & Build (Home)', price: 30 },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior Program', price: 45 },
  { keywords: ['40', 'menopause', 'joints', 'senior', 'knee', 'back pain'], program: '40plus', name: '40+ Strong Program', price: 50 },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'advanced', 'compete'], program: '12wk', name: '12-Week Flagship Program', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'confused'], program: 'zoom_trial', name: '$20 Zoom Trial', price: 20 }
];

function qualifyLead(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();

  for (const route of ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

function getProgramDuration(program) {
  switch (program) {
    case '6wk_gym':
    case '6wk_home':
      return 6;
    case '12wk':
      return 12;
    case 'pcos':
    case '40plus':
      return 8;
    case 'zoom_trial':
      return 1;
    case 'zoom_pack':
      return 4;
    default:
      return 6;
  }
}

module.exports = { qualifyLead, getProgramDuration, ROUTES };
