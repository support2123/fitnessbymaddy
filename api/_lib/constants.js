const PROGRAMS = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 9700, duration_weeks: 6 },
  '6wk_home': { name: '6-Week Burn & Build (Home)', price: 9700, duration_weeks: 6 },
  '12wk': { name: '12-Week Flagship', price: 20000, duration_weeks: 12 },
  'pcos': { name: 'PCOS Warrior', price: 4500, duration_weeks: 8 },
  '40plus': { name: '40+ Strong', price: 5000, duration_weeks: 8 },
  'zoom_trial': { name: 'Zoom Trial Session', price: 2000, duration_weeks: 1 },
  'zoom_pack': { name: 'Zoom Pack (4 sessions)', price: 7500, duration_weeks: 4 }
};

const KEYWORD_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'lean'], program: '6wk_gym' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular'], program: 'pcos' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'knee', 'senior'], program: '40plus' },
  { keywords: ['custom', '12 week', 'serious', 'transform', 'flagship', 'personalised'], program: '12wk' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'demo'], program: 'zoom_trial' }
];

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
  'faint', 'chest pain', 'heart'
];

const MADDY_PHONE = '+917082478374';

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

module.exports = { PROGRAMS, KEYWORD_ROUTES, ESCALATION_KEYWORDS, MADDY_PHONE, RATE_LIMIT_MS };
