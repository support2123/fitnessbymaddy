function detectMarket(phone) {
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/fat\s*loss|weight|shred|lean|cut/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone|period|irregular/.test(lower)) return 'pcos';
  if (/40|forty|menopause|joints|senior|mature/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|advanced/.test(lower)) return '12wk';
  if (/trial|zoom|not\s*sure|try|test/.test(lower)) return 'zoom_trial';
  if (/home|bodyweight|no\s*gym|apartment/.test(lower)) return '6wk_home';
  return null;
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Flagship Program',
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

const PROGRAM_DURATIONS_WEEKS = {
  '6wk_gym': 6,
  '6wk_home': 6,
  '12wk': 12,
  'pcos': 8,
  '40plus': 8,
  'zoom_trial': 1,
  'zoom_pack': 8
};

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const triggers = [
    'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
    'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex', 'bulimi',
    'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
    'chest pain', 'faint', 'vomit', 'blood pressure', 'diabetes',
    'surgery', 'hospitali'
  ];
  return triggers.some(t => lower.includes(t));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel messages'].includes(lower);
}

function isHinglish(market) {
  return market === 'IN';
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = {
  detectMarket,
  maskPhone,
  matchProgram,
  needsEscalation,
  isOptOut,
  isHinglish,
  cors,
  PROGRAM_NAMES,
  PROGRAM_PRICES,
  PROGRAM_DURATIONS_WEEKS
};
