const PROGRAM_ROUTES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'slim', 'burn', 'lose fat', 'cut'],
    program: '6wk_gym',
    name: '6-Week Burn & Build',
    price: 97,
  },
  {
    keywords: ['home', 'no gym', 'home workout', 'bodyweight', 'at home'],
    program: '6wk_home',
    name: '6-Week Home Shred',
    price: 97,
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
    program: 'pcos',
    name: 'PCOS Warrior Program',
    price: 45,
  },
  {
    keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior', 'age'],
    program: '40plus',
    name: '40+ Strong Program',
    price: 50,
  },
  {
    keywords: ['custom', '12 week', '12week', 'serious', 'flagship', 'personali', 'transform'],
    program: '12wk',
    name: '12-Week Flagship Program',
    price: 200,
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'one session', 'sample'],
    program: 'zoom_trial',
    name: 'Zoom Trial Session',
    price: 20,
  },
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel messages'];

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(kw => lower.includes(kw));
}

module.exports = { PROGRAM_ROUTES, matchProgram, isOptOut };
