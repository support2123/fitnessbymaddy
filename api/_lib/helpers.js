function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglishMarket(phone) {
  return detectMarket(phone) === 'IN';
}

function normalizePhone(phone) {
  let cleaned = phone.replace(/[\s\-()]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('91') && cleaned.length === 12) cleaned = '+' + cleaned;
    else if (cleaned.length === 10) cleaned = '+91' + cleaned;
    else cleaned = '+' + cleaned;
  }
  return cleaned;
}

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex', 'bulimi',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'chest pain', 'heart', 'faint', 'vomit'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/\b(stop|unsubscribe|opt.?out)\b/.test(lower)) return 'OPTOUT';

  if (/\b(fat.?loss|weight|shred|lean|cut|slim)\b/.test(lower)) return '6wk_gym';
  if (/\b(pcos|hormonal|hormone|period|irregular)\b/.test(lower)) return 'pcos';
  if (/\b(40|forty|menopause|joint|knee|back pain|senior)\b/.test(lower)) return '40plus';
  if (/\b(custom|12.?week|serious|flagship|full|transform)\b/.test(lower)) return '12wk';
  if (/\b(home|bodyweight|no.?gym|at.?home)\b/.test(lower)) return '6wk_home';
  if (/\b(trial|zoom|try|not sure|unsure|test)\b/.test(lower)) return 'zoom_trial';

  return null;
}

const PROGRAM_INFO = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 97, checkout: '6wk-gym' },
  '6wk_home': { name: '6-Week Burn & Build (Home)', price: 97, checkout: '6wk-home' },
  '12wk': { name: '12-Week Custom Program', price: 200, checkout: '12wk-custom' },
  'pcos': { name: 'PCOS Warrior Program', price: 45, checkout: 'pcos-warrior' },
  '40plus': { name: '40+ Strong Program', price: 50, checkout: '40plus-strong' },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20, checkout: 'zoom-trial' },
  'zoom_pack': { name: 'Zoom Pack', price: 150, checkout: 'zoom-pack' }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': process.env.SITE_URL || 'https://www.fitnessbymaddy.com',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  };
}

function jsonResponse(res, status, data) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  return res.status(status).json(data);
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglishMarket,
  normalizePhone,
  needsEscalation,
  classifyIntent,
  PROGRAM_INFO,
  corsHeaders,
  jsonResponse
};
