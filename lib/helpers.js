function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/\b(fat\s*loss|weight|shred|slim|lean|burn)\b/.test(lower)) {
    return { program: '6wk_gym', name: '6 Week Burn & Build', price: 97 };
  }
  if (/\b(pcos|hormonal|thyroid|period|irregular)\b/.test(lower)) {
    return { program: 'pcos', name: 'PCOS Warrior', price: 45 };
  }
  if (/\b(40|forty|menopause|joints|senior|age)\b/.test(lower)) {
    return { program: '40plus', name: '40+ Strong', price: 50 };
  }
  if (/\b(custom|12\s*week|serious|flagship|full|premium)\b/.test(lower)) {
    return { program: '12wk', name: '12-Week Flagship', price: 200 };
  }
  if (/\b(trial|zoom|not\s*sure|try|test|sample)\b/.test(lower)) {
    return { program: 'zoom_trial', name: 'Zoom Trial', price: 20 };
  }
  if (/\b(home|bodyweight|no\s*gym|at\s*home)\b/.test(lower)) {
    return { program: '6wk_home', name: '6 Week Home Program', price: 79 };
  }

  return null;
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'injured', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia', 'bulimia',
  'vomit', 'faint', 'chest pain', 'heart',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'].includes(lower);
}

function weeksBetween(start, end) {
  const ms = new Date(end) - new Date(start);
  return Math.floor(ms / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function programDurationWeeks(program) {
  const map = {
    '6wk_gym': 6,
    '6wk_home': 6,
    '12wk': 12,
    'pcos': 8,
    '40plus': 8,
    'zoom_trial': 1,
    'zoom_pack': 4,
  };
  return map[program] || 6;
}

module.exports = {
  detectMarket,
  classifyIntent,
  needsEscalation,
  isOptOut,
  weeksBetween,
  programDurationWeeks,
};
