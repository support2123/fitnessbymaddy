function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('91') || cleaned.startsWith('091')) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function detectProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/fat\s*loss|weight|shred|lean/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|period|cycle/.test(lower)) return 'pcos';
  if (/40|menopause|joint|knee|back pain|senior/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|transform/.test(lower)) return '12wk';
  if (/trial|zoom|not sure|try|test/.test(lower)) return 'zoom_trial';
  if (/home|no\s*gym|bodyweight|at\s*home/.test(lower)) return '6wk_home';
  return null;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel', 'remove me'].includes(lower);
}

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder', 'anorex', 'bulimi',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'heart', 'surgery', 'doctor', 'hospital'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function programCheckoutUrl(program, leadId) {
  const slugs = {
    '6wk_gym': '6-week-burn-build',
    '6wk_home': '6-week-burn-build-home',
    'pcos': 'pcos-warrior',
    '40plus': '40-plus-strong',
    '12wk': '12-week-flagship',
    'zoom_trial': 'zoom-trial',
    'zoom_pack': 'zoom-pack'
  };
  const slug = slugs[program] || program;
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${slug}`;
}

function programDisplayName(program) {
  const names = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    '12wk': '12-Week Flagship Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack'
  };
  return names[program] || program;
}

function isHinglish(market) {
  return market === 'IN';
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

module.exports = {
  maskPhone, detectMarket, detectProgram, isOptOut,
  needsEscalation, programCheckoutUrl, programDisplayName,
  isHinglish, corsHeaders
};
