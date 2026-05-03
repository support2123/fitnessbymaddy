const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lean', 'cut', 'slim'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period', 'thyroid'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', 'age'],
  '12wk': ['custom', '12 week', 'serious', 'flagship', 'personalised', 'personalized', 'transform'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'demo']
};

function detectProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return program;
    }
  }
  return null;
}

function isOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'].includes(lower);
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Program',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Session Pack'
};

const PROGRAM_PRICES = {
  '6wk_gym': 97,
  '6wk_home': 97,
  '12wk': 200,
  'pcos': 45,
  '40plus': 50,
  'zoom_trial': 20,
  'zoom_pack': 80
};

module.exports = { detectProgram, isOptOut, PROGRAM_NAMES, PROGRAM_PRICES };
