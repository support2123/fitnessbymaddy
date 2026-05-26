const PROGRAMS = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 97, weeks: 6 },
  '6wk_home': { name: '6-Week Burn & Build (Home)', price: 97, weeks: 6 },
  '12wk': { name: '12-Week Custom Training', price: 200, weeks: 12 },
  pcos: { name: 'PCOS Warrior', price: 45, weeks: 8 },
  '40plus': { name: '40+ Strong', price: 50, weeks: 8 },
  zoom_trial: { name: 'Zoom Trial Session', price: 20, weeks: 1 },
  zoom_pack: { name: 'Zoom Session Pack', price: 100, weeks: 4 },
};

const KEYWORD_TO_PROGRAM = [
  { keywords: ['fat loss', 'weight', 'shred', 'burn', 'lose'], program: '6wk_gym' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos' },
  { keywords: ['40', 'menopause', 'joints', 'joint', '40+', 'forty'], program: '40plus' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'full'], program: '12wk' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial' },
];

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'not eating', 'vomit',
];

const MADDY_PHONE = '+917082478374';

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

module.exports = {
  PROGRAMS,
  KEYWORD_TO_PROGRAM,
  ESCALATION_KEYWORDS,
  MADDY_PHONE,
  RATE_LIMIT_MS,
};
