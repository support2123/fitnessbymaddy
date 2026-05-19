const PROGRAM_MAP = {
  'fat loss': '6wk_gym',
  'weight': '6wk_gym',
  'shred': '6wk_gym',
  'lose': '6wk_gym',
  'pcos': 'pcos',
  'hormonal': 'pcos',
  'pcod': 'pcos',
  '40': '40plus',
  'menopause': '40plus',
  'joints': '40plus',
  'custom': '12wk',
  '12 week': '12wk',
  'serious': '12wk',
  'personalised': '12wk',
  'personalized': '12wk',
  'trial': 'zoom_trial',
  'zoom': 'zoom_trial',
  'not sure': 'zoom_trial',
  'try': 'zoom_trial',
  'home': '6wk_home'
};

const PROGRAM_DETAILS = {
  '6wk_gym': { name: '6 Week Burn & Build (Gym)', price: 97, weeks: 6 },
  '6wk_home': { name: '6 Week Burn & Build (Home)', price: 97, weeks: 6 },
  '12wk': { name: '12 Week Custom Training', price: 200, weeks: 12 },
  'pcos': { name: 'PCOS Warrior Program', price: 45, weeks: 8 },
  '40plus': { name: '40+ Strong Program', price: 50, weeks: 8 },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20, weeks: 1 },
  'zoom_pack': { name: 'Zoom Pack (4 Sessions)', price: 60, weeks: 4 }
};

function matchProgram(message) {
  if (!message) return null;
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
