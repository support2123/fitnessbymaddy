const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lose weight', 'slim', 'lean'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', 'aging'],
  '12wk': ['custom', '12 week', 'twelve week', 'serious', 'transform', 'flagship', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'sample']
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  '6wk_home': '6-Week Home Shred',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Custom Training',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Session Pack'
};

const PROGRAM_PRICES = {
  '6wk_gym': 97,
  '6wk_home': 97,
  'pcos': 45,
  '40plus': 50,
  '12wk': 200,
  'zoom_trial': 20,
  'zoom_pack': 150
};

function detectProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return program;
    }
  }
  return null;
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

module.exports = { detectProgram, isOptOut, PROGRAM_NAMES, PROGRAM_PRICES };
