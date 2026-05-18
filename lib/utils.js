function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function matchProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  if (/fat\s*loss|weight|shred|lean|cut|slim/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone|period|irregular/.test(lower)) return 'pcos';
  if (/40\+?|forty|menopause|joints|senior|mature/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|transform/.test(lower)) return '12wk';
  if (/trial|zoom|not\s*sure|try|test|sample/.test(lower)) return 'zoom_trial';
  if (/home|bodyweight|no\s*gym|at\s*home/.test(lower)) return '6wk_home';

  return null;
}

const PROGRAM_INFO = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 97, weeks: 6 },
  '6wk_home': { name: '6-Week Burn & Build (Home)', price: 97, weeks: 6 },
  '12wk': { name: '12-Week Custom Flagship', price: 200, weeks: 12 },
  'pcos': { name: 'PCOS Warrior Program', price: 45, weeks: 8 },
  '40plus': { name: '40+ Strong Program', price: 50, weeks: 8 },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20, weeks: 1 },
  'zoom_pack': { name: 'Zoom Session Pack', price: 150, weeks: 4 }
};

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex',
  'bulimi', 'fainting', 'chest pain', 'heart'
];

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

function getLanguage(market) {
  return market === 'IN' ? 'hinglish' : 'english';
}

function json(res, data, status = 200) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).json(data);
}

function calculateWeekNo(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  return Math.max(1, Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000)));
}

module.exports = {
  maskPhone,
  detectMarket,
  matchProgram,
  PROGRAM_INFO,
  needsEscalation,
  isOptOut,
  getLanguage,
  json,
  calculateWeekNo
};
