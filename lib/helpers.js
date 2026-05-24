function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function detectProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/fat\s*loss|weight|shred|lean/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|period|irregular/.test(lower)) return 'pcos';
  if (/40\+?|menopause|joints|senior|mature/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|personal/.test(lower)) return '12wk';
  if (/trial|zoom|not\s*sure|try/.test(lower)) return 'zoom_trial';
  if (/home|bodyweight|no\s*gym/.test(lower)) return '6wk_home';
  return null;
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Training',
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

const PROGRAM_DURATIONS_WEEKS = {
  '6wk_gym': 6,
  '6wk_home': 6,
  '12wk': 12,
  'pcos': 6,
  '40plus': 6,
  'zoom_trial': 1,
  'zoom_pack': 8,
};

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia',
  'bulimia', 'faint', 'chest pain', 'heart',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'remove me'].includes(lower);
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function weeksBetween(start, now) {
  const diff = now.getTime() - new Date(start).getTime();
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
}

module.exports = {
  detectMarket,
  detectProgram,
  PROGRAM_NAMES,
  PROGRAM_PRICES,
  PROGRAM_DURATIONS_WEEKS,
  needsEscalation,
  isOptOut,
  corsHeaders,
  weeksBetween,
};
