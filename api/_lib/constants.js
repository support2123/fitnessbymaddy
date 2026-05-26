const PROGRAMS = {
  '6wk_gym': { name: '6 Week Burn & Build (Gym)', price: 97, duration: 42 },
  '6wk_home': { name: '6 Week Burn & Build (Home)', price: 97, duration: 42 },
  '12wk': { name: '12 Week Custom Training', price: 200, duration: 84 },
  'pcos': { name: 'PCOS Warrior Program', price: 45, duration: 42 },
  '40plus': { name: '40+ Strong Program', price: 50, duration: 42 },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20, duration: 7 },
  'zoom_pack': { name: 'Zoom Pack (4 Sessions)', price: 120, duration: 30 }
};

const KEYWORD_MAP = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'lean'], program: '6wk_gym' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'mature'], program: '40plus' },
  { keywords: ['custom', '12 week', 'serious', 'transform', 'flagship'], program: '12wk' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial' }
];

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'pain', 'dizziness', 'injury', 'medical', 'pregnant', 'pregnancy',
  'medication', 'eating disorder', 'disordered eating'
];

module.exports = { PROGRAMS, KEYWORD_MAP, ESCALATION_KEYWORDS };
