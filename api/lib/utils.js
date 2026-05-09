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
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/\b(fat\s*loss|weight|shred|lose|slim|lean)\b/.test(lower)) return '6wk_gym';
  if (/\b(pcos|hormonal|hormone|period|irregular)\b/.test(lower)) return 'pcos';
  if (/\b(40|forty|menopause|joints?|senior|older)\b/.test(lower)) return '40plus';
  if (/\b(custom|12\s*week|serious|flagship|transform)\b/.test(lower)) return '12wk';
  if (/\b(trial|zoom|not\s*sure|try|test)\b/.test(lower)) return 'zoom_trial';
  if (/\b(home|no\s*gym|bodyweight|at\s*home)\b/.test(lower)) return '6wk_home';
  return null;
}

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'not working', 'cancel', 'stop', 'unsubscribe'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

function programLabel(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Flagship Program',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack',
  };
  return map[code] || code;
}

function programPrice(code) {
  const map = {
    '6wk_gym': 97,
    '6wk_home': 97,
    '12wk': 200,
    'pcos': 45,
    '40plus': 50,
    'zoom_trial': 20,
    'zoom_pack': 120,
  };
  return map[code] || 0;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

module.exports = {
  detectMarket,
  maskPhone,
  classifyIntent,
  needsEscalation,
  isOptOut,
  programLabel,
  programPrice,
  corsHeaders,
  jsonResponse,
};
