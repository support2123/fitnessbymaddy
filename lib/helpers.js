function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (phone.startsWith('91') || phone.startsWith('+91')) return 'IN';
  if (phone.startsWith('971') || phone.startsWith('+971')) return 'UAE';
  if (phone.startsWith('44') || phone.startsWith('+44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

function normalizePhone(phone) {
  return phone.replace(/[^0-9]/g, '');
}

function classifyIntent(text) {
  const lower = (text || '').toLowerCase();
  if (/fat\s*loss|weight|shred|lose/i.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone/i.test(lower)) return 'pcos';
  if (/40|menopause|joints|senior|aging/i.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|personali/i.test(lower)) return '12wk';
  if (/trial|zoom|not\s*sure|try/i.test(lower)) return 'zoom_trial';
  if (/home|bodyweight|no\s*gym|at\s*home/i.test(lower)) return '6wk_home';
  return null;
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior',
  '40plus': '40+ Strong',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Pack'
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

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'not eating', 'faint', 'chest pain', 'heart'
];

function needsEscalation(text) {
  const lower = (text || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function programWeeks(program) {
  if (program === '12wk') return 12;
  if (program.startsWith('6wk')) return 6;
  if (program === 'pcos' || program === '40plus') return 6;
  return 4;
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglish,
  normalizePhone,
  classifyIntent,
  needsEscalation,
  isOptOut,
  cors,
  programWeeks,
  PROGRAM_NAMES,
  PROGRAM_PRICES,
  ESCALATION_KEYWORDS
};
