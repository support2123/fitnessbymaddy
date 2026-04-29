function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  const clean = phone.replace('+', '');
  if (clean.startsWith('91')) return 'IN';
  if (clean.startsWith('971')) return 'UAE';
  if (clean.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function classifyIntent(message) {
  const lower = message.toLowerCase().trim();

  if (/\b(fat\s*loss|weight|shred|lean|cut|slim)\b/.test(lower)) {
    return { program: '6wk_gym', label: '6-Week Burn & Build', price: 97 };
  }
  if (/\b(pcos|hormonal|hormone|period|irregular)\b/.test(lower)) {
    return { program: 'pcos', label: 'PCOS Warrior', price: 45 };
  }
  if (/\b(40|forty|menopause|joints|senior|age)\b/.test(lower)) {
    return { program: '40plus', label: '40+ Strong', price: 50 };
  }
  if (/\b(custom|12\s*week|serious|flagship|premium|full)\b/.test(lower)) {
    return { program: '12wk', label: '12-Week Flagship', price: 200 };
  }
  if (/\b(trial|zoom|not\s*sure|try|test|sample)\b/.test(lower)) {
    return { program: 'zoom_trial', label: 'Zoom Trial', price: 20 };
  }
  if (/\b(home|no\s*gym|bodyweight|at\s*home)\b/.test(lower)) {
    return { program: '6wk_home', label: '6-Week Home Program', price: 79 };
  }

  return null;
}

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder', 'bulimi', 'anorexi',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'surgery', 'hospital', 'doctor', 'heart', 'diabetes'
];

function needsEscalation(message) {
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(message) {
  const lower = message.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel', 'remove me'].includes(lower);
}

function getGreeting(market) {
  if (market === 'IN') {
    return "Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?";
  }
  return "Hi! Maddy's team here. What's your fitness goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";
}

function getProgramEndDate(program, startDate) {
  const start = new Date(startDate);
  const weeks = program.startsWith('12wk') ? 12
    : program.startsWith('6wk') ? 6
    : program === 'pcos' ? 6
    : program === '40plus' ? 6
    : program === 'zoom_trial' ? 1
    : program === 'zoom_pack' ? 4
    : 6;
  start.setDate(start.getDate() + weeks * 7);
  return start.toISOString();
}

function getCurrentWeek(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return diffWeeks + 1;
}

function generateToken(clientId, weekNo) {
  const raw = `${clientId}-${weekNo}-${process.env.SUPABASE_SERVICE_KEY?.slice(0, 8) || 'salt'}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

module.exports = {
  maskPhone,
  detectMarket,
  classifyIntent,
  needsEscalation,
  isOptOut,
  getGreeting,
  getProgramEndDate,
  getCurrentWeek,
  generateToken,
  ESCALATION_KEYWORDS
};
