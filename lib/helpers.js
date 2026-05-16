function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

function detectProgram(message) {
  const lower = (message || '').toLowerCase();
  if (/fat\s*loss|weight|shred|slim|lean/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|period|irregular/.test(lower)) return 'pcos';
  if (/40|menopause|joints|senior|mature/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|transform/.test(lower)) return '12wk';
  if (/trial|zoom|not\s*sure|try|test/.test(lower)) return 'zoom_trial';
  if (/home|no\s*gym|bodyweight/.test(lower)) return '6wk_home';
  return null;
}

function getProgramDetails(program) {
  const programs = {
    '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 97, weeks: 6 },
    '6wk_home': { name: '6-Week Burn & Build (Home)', price: 97, weeks: 6 },
    '12wk': { name: '12-Week Custom Flagship', price: 200, weeks: 12 },
    'pcos': { name: 'PCOS Warrior Program', price: 45, weeks: 8 },
    '40plus': { name: '40+ Strong Program', price: 50, weeks: 8 },
    'zoom_trial': { name: 'Zoom Trial Session', price: 20, weeks: 1 },
    'zoom_pack': { name: 'Zoom Session Pack', price: 150, weeks: 4 }
  };
  return programs[program] || null;
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex',
  'bulimi', 'not eating', 'faint', 'hospital'
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

function getLanguage(market) {
  return market === 'IN' ? 'hinglish' : 'english';
}

module.exports = {
  detectMarket,
  maskPhone,
  detectProgram,
  getProgramDetails,
  needsEscalation,
  isOptOut,
  getLanguage,
  ESCALATION_KEYWORDS
};
