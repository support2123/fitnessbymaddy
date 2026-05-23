const PROGRAM_MAP = {
  '6wk_gym': { name: '6 Week Burn & Build (Gym)', price: 97, weeks: 6 },
  '6wk_home': { name: '6 Week Burn & Build (Home)', price: 97, weeks: 6 },
  '12wk': { name: '12-Week Custom Flagship', price: 200, weeks: 12 },
  'pcos': { name: 'PCOS Warrior', price: 45, weeks: 6 },
  '40plus': { name: '40+ Strong', price: 50, weeks: 6 },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20, weeks: 1 },
  'zoom_pack': { name: 'Zoom Pack (4 sessions)', price: 70, weeks: 4 }
};

const KEYWORD_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'slim'], program: '6wk_gym' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'irregular period'], program: 'pcos' },
  { keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'mature'], program: '40plus' },
  { keywords: ['custom', '12 week', 'twelve week', 'serious', 'flagship', 'personal'], program: '12wk' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial' }
];

function routeToProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

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

function getCheckoutUrl(checkoutId) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${checkoutId}`;
}

module.exports = { routeToProgram, getProgramInfo, getCheckoutUrl, PROGRAM_MAP };
