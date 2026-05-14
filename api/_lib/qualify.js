const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'slim', 'fat'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period', 'pcod'],
  '40plus': ['40', '40+', 'menopause', 'joints', 'joint pain', 'senior', 'over 40'],
  '12wk': ['custom', '12 week', '12-week', 'serious', 'personalised', 'personalized', 'flagship'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'demo', 'test']
};

function qualifyLead(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return program;
    }
  }
  return null;
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
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
  'zoom_pack': 150
};

module.exports = { qualifyLead, isOptOut, PROGRAM_NAMES, PROGRAM_PRICES };
