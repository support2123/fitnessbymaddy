const PROGRAM_MAP = {
  '6wk_gym': {
    name: '6 Week Burn & Build (Gym)',
    price: 97,
    duration_weeks: 6,
    keywords: ['fat loss', 'weight loss', 'shred', 'lean', 'burn', 'weight', 'lose']
  },
  '6wk_home': {
    name: '6 Week Burn & Build (Home)',
    price: 97,
    duration_weeks: 6,
    keywords: ['home', 'no gym', 'bodyweight']
  },
  'pcos': {
    name: 'PCOS Warrior',
    price: 45,
    duration_weeks: 8,
    keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'thyroid']
  },
  '40plus': {
    name: '40+ Strong',
    price: 50,
    duration_weeks: 8,
    keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'older']
  },
  '12wk': {
    name: '12 Week Flagship',
    price: 200,
    duration_weeks: 12,
    keywords: ['custom', '12 week', 'serious', 'personal', 'flagship', 'customised']
  },
  'zoom_trial': {
    name: 'Zoom Trial Session',
    price: 20,
    duration_weeks: 1,
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test']
  },
  'zoom_pack': {
    name: 'Zoom Session Pack',
    price: 150,
    duration_weeks: 4,
    keywords: ['zoom pack', 'sessions', '1 on 1', 'one on one']
  }
};

function detectProgram(message) {
  const lower = message.toLowerCase();
  for (const [key, program] of Object.entries(PROGRAM_MAP)) {
    if (program.keywords.some(kw => lower.includes(kw))) {
      return { key, ...program };
    }
  }
  return null;
}

function getProgramByKey(key) {
  const p = PROGRAM_MAP[key];
  return p ? { key, ...p } : null;
}

module.exports = { PROGRAM_MAP, detectProgram, getProgramByKey };
