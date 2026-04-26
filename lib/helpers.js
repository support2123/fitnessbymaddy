function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const clean = phone.replace(/\D/g, '');
  if (clean.startsWith('91')) return 'IN';
  if (clean.startsWith('971')) return 'UAE';
  if (clean.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex', 'bulimi',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'vomit', 'faint', 'chest pain', 'heart'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

const OPTOUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'];

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return OPTOUT_KEYWORDS.some(kw => lower === kw || lower.includes(kw));
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/fat\s*loss|weight|shred|lean|cut/i.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone/i.test(lower)) return 'pcos';
  if (/40|forty|menopause|joints|joint/i.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|advanced|flagship/i.test(lower)) return '12wk';
  if (/trial|zoom|not sure|try|test/i.test(lower)) return 'zoom_trial';
  if (/home|bodyweight|no\s*gym|no\s*equipment/i.test(lower)) return '6wk_home';

  return null;
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Program',
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
  'zoom_pack': 80
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglish,
  needsEscalation,
  isOptOut,
  classifyIntent,
  PROGRAM_NAMES,
  PROGRAM_PRICES,
  ESCALATION_KEYWORDS,
  corsHeaders,
  jsonResponse,
  errorResponse
};
