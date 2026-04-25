const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'not eating',
  'medical condition', 'surgery'
];

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'lean', 'fat'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40', '40+', 'menopause', 'joints', 'joint pain', 'over 40'],
  '12wk': ['custom', '12 week', '12-week', 'serious', 'personali', 'flagship'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test']
};

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('91') || cleaned.startsWith('+91')) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function detectProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return program;
  }
  return null;
}

function needsEscalation(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'optout'].includes(lower);
}

function getProgramName(code) {
  const names = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack'
  };
  return names[code] || code;
}

function getProgramDuration(code) {
  const durations = {
    '6wk_gym': 42,
    '6wk_home': 42,
    '12wk': 84,
    'pcos': 42,
    '40plus': 42,
    'zoom_trial': 7,
    'zoom_pack': 30
  };
  return durations[code] || 42;
}

function useHinglish(market) {
  return market === 'IN';
}

module.exports = {
  detectMarket, detectProgram, needsEscalation, isOptOut,
  getProgramName, getProgramDuration, useHinglish
};
