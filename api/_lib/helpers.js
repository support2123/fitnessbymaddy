function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const clean = phone.replace(/[^0-9+]/g, '');
  if (clean.startsWith('+91') || clean.startsWith('91')) return 'IN';
  if (clean.startsWith('+971') || clean.startsWith('971')) return 'UAE';
  if (clean.startsWith('+44') || clean.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/fat\s*loss|weight|shred|lean/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|pcod/.test(lower)) return 'pcos';
  if (/40|menopause|joints|senior|mature/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|transform/.test(lower)) return '12wk';
  if (/trial|zoom|not\s*sure|try/.test(lower)) return 'zoom_trial';
  if (/home|bodyweight|no\s*gym|at\s*home/.test(lower)) return '6wk_home';
  return null;
}

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const triggers = [
    'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
    'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
    'refund', 'lawyer', 'complaint', 'didn\'t work', 'didn\'t work',
    'side effect', 'chest pain', 'heart', 'surgery', 'doctor said'
  ];
  return triggers.some(t => lower.includes(t));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'remove me'].includes(lower);
}

function isHinglish(market) {
  return market === 'IN';
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Flagship Program',
  'pcos': 'PCOS Warrior',
  '40plus': '40+ Strong',
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

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

module.exports = {
  detectMarket,
  maskPhone,
  matchProgram,
  needsEscalation,
  isOptOut,
  isHinglish,
  PROGRAM_NAMES,
  PROGRAM_PRICES,
  PROGRAM_DURATIONS
};
