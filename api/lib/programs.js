const PROGRAM_MAP = {
  'fat loss': '6wk_gym',
  'weight': '6wk_gym',
  'shred': '6wk_gym',
  'lose': '6wk_gym',
  'burn': '6wk_gym',
  'pcos': 'pcos',
  'hormonal': 'pcos',
  'pcod': 'pcos',
  '40': '40plus',
  'menopause': '40plus',
  'joints': '40plus',
  'custom': '12wk',
  '12 week': '12wk',
  'serious': '12wk',
  'flagship': '12wk',
  'trial': 'zoom_trial',
  'zoom': 'zoom_trial',
  'not sure': 'zoom_trial',
  'try': 'zoom_trial'
};

const PROGRAM_DETAILS = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 35, duration_weeks: 6 },
  '6wk_home': { name: '6-Week Burn & Build (Home)', price: 30, duration_weeks: 6 },
  '12wk': { name: '12-Week Flagship Program', price: 200, duration_weeks: 12 },
  'pcos': { name: 'PCOS Warrior', price: 45, duration_weeks: 8 },
  '40plus': { name: '40+ Strong', price: 50, duration_weeks: 8 },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20, duration_weeks: 1 },
  'zoom_pack': { name: 'Zoom Pack (4 sessions)', price: 70, duration_weeks: 4 }
};

function matchProgram(message) {
  const lower = message.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

function getProgramDetails(programKey) {
  return PROGRAM_DETAILS[programKey] || null;
}

module.exports = { matchProgram, getProgramDetails, PROGRAM_DETAILS };
