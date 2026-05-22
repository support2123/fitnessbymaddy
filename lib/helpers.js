function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

function detectProgramInterest(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/fat\s*loss|weight|shred|lean|cut/i.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone|period|irregular/i.test(lower)) return 'pcos';
  if (/40\+?|forty|menopause|joint|knee|back pain/i.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|transform/i.test(lower)) return '12wk';
  if (/trial|zoom|not sure|try|test|check/i.test(lower)) return 'zoom_trial';
  if (/home|no\s*gym|bodyweight|at\s*home/i.test(lower)) return '6wk_home';
  return null;
}

const PROGRAM_LABELS = {
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

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'anorex', 'bulim', 'purge', 'not eating',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

function isHinglish(market) {
  return market === 'IN';
}

function programWeekCount(program) {
  if (program === '12wk') return 12;
  if (program?.startsWith('6wk')) return 6;
  if (program === 'pcos') return 8;
  if (program === '40plus') return 8;
  return 4;
}

module.exports = {
  detectMarket,
  maskPhone,
  detectProgramInterest,
  needsEscalation,
  isOptOut,
  isHinglish,
  programWeekCount,
  PROGRAM_LABELS,
  PROGRAM_PRICES,
};
