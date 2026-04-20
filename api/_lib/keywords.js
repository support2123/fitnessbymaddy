const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'lean', 'cut'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', 'over 40'],
  '12wk': ['custom', '12 week', 'serious', 'flagship', 'full program', 'advanced'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'confused'],
};

const PROGRAM_INFO = {
  '6wk_gym': { name: '6-Week Burn & Build', price: 97, checkout: '6wk-burn' },
  '6wk_home': { name: '6-Week Home Edition', price: 79, checkout: '6wk-home' },
  'pcos': { name: 'PCOS Warrior', price: 45, checkout: 'pcos-warrior' },
  '40plus': { name: '40+ Strong', price: 50, checkout: '40plus-strong' },
  '12wk': { name: '12-Week Flagship', price: 200, checkout: '12wk-flagship' },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20, checkout: 'zoom-trial' },
  'zoom_pack': { name: 'Zoom Pack (4 sessions)', price: 70, checkout: 'zoom-pack' },
};

const STOP_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'leave me alone'];

export function matchProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return program;
    }
  }
  return null;
}

export function getProgramInfo(programKey) {
  return PROGRAM_INFO[programKey] || null;
}

export function isOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return STOP_KEYWORDS.some(kw => lower.includes(kw));
}
