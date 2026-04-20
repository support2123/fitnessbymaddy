const PROGRAMS = {
  '6wk_gym':     { name: '6-Week Burn & Build (Gym)', price: 97, duration_weeks: 6 },
  '6wk_home':    { name: '6-Week Burn & Build (Home)', price: 97, duration_weeks: 6 },
  '12wk':        { name: '12-Week Custom Flagship', price: 200, duration_weeks: 12 },
  'pcos':        { name: 'PCOS Warrior', price: 45, duration_weeks: 8 },
  '40plus':      { name: '40+ Strong', price: 50, duration_weeks: 8 },
  'zoom_trial':  { name: 'Zoom Trial Session', price: 20, duration_weeks: 1 },
  'zoom_pack':   { name: 'Zoom 4-Pack', price: 70, duration_weeks: 4 },
};

const KEYWORD_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'burn', 'lean'], program: '6wk_gym' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos' },
  { keywords: ['40', 'menopause', 'joints', 'joint pain', 'senior'], program: '40plus' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'full'], program: '12wk' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'ghar'], program: '6wk_home' },
];

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia', 'bulimia',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'surgery', 'doctor', 'hospital'
];

const MADDY_PHONE = '+917082478374';

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

module.exports = { PROGRAMS, KEYWORD_ROUTES, ESCALATION_KEYWORDS, MADDY_PHONE, RATE_LIMIT_MS };
