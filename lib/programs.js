const PROGRAM_MAP = {
  '6wk_gym': { name: '6-Week Burn & Build', price: 97, duration: 6, unit: 'weeks' },
  '6wk_home': { name: '6-Week Home Shred', price: 97, duration: 6, unit: 'weeks' },
  '12wk': { name: '12-Week Custom Training', price: 200, duration: 12, unit: 'weeks' },
  'pcos': { name: 'PCOS Warrior Program', price: 45, duration: 8, unit: 'weeks' },
  '40plus': { name: '40+ Strong Program', price: 50, duration: 8, unit: 'weeks' },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20, duration: 1, unit: 'session' },
  'zoom_pack': { name: 'Zoom Pack (4 Sessions)', price: 70, duration: 4, unit: 'sessions' },
};

const KEYWORD_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lean', 'cut'], program: '6wk_gym' },
  { keywords: ['pcos', 'hormonal', 'hormone'], program: 'pcos' },
  { keywords: ['40', 'menopause', 'joints', 'senior', 'knee'], program: '40plus' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'personal'], program: '12wk' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home' },
];

function routeToProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const route of KEYWORD_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route.program;
    }
  }
  return null;
}

function getProgramInfo(programKey) {
  return PROGRAM_MAP[programKey] || null;
}

module.exports = { PROGRAM_MAP, routeToProgram, getProgramInfo };
