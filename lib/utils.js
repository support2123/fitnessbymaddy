function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function detectProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  if (/fat\s*loss|weight|shred|burn/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|pcod/.test(lower)) return 'pcos';
  if (/40\+?|forty|menopause|joints|joint/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|personalised|personalized/.test(lower)) return '12wk';
  if (/trial|zoom|not\s*sure|try/.test(lower)) return 'zoom_trial';
  if (/home|bodyweight|no\s*gym/.test(lower)) return '6wk_home';
  return null;
}

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex', 'bulimi',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'didn\'t work',
  'side effect', 'surgery', 'doctor', 'hospital',
];

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'].includes(lower);
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Program',
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

module.exports = {
  maskPhone,
  detectMarket,
  detectProgram,
  needsEscalation,
  isOptOut,
  PROGRAM_NAMES,
  PROGRAM_PRICES,
};
