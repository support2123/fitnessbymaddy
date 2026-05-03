const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'shred', 'lean', 'cut', 'burn', 'patla', 'weight kam'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular period'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior', '40+'],
  '12wk': ['custom', '12 week', 'serious', 'flagship', 'personali', 'dedicated', 'full program'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'confused', 'pehle try', 'test'],
  '6wk_home': ['home', 'ghar', 'no gym', 'bodyweight', 'home workout'],
};

function matchProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}

function isOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return ['stop', 'unsubscribe', 'cancel', 'band karo', 'mat bhejo'].some(kw => lower.includes(kw));
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Flagship Program',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Session Pack',
};

const PROGRAM_PRICES = {
  '6wk_gym': 97,
  '6wk_home': 97,
  '12wk': 200,
  'pcos': 45,
  '40plus': 50,
  'zoom_trial': 20,
  'zoom_pack': 150,
};

module.exports = { matchProgram, isOptOut, PROGRAM_NAMES, PROGRAM_PRICES };
