function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  if (/\b(fat\s*loss|weight|shred|lean|slim|cut)\b/.test(lower)) return '6wk_gym';
  if (/\b(pcos|hormonal|hormone|irregular\s*period)\b/.test(lower)) return 'pcos';
  if (/\b(40|forty|menopause|joints|senior|older)\b/.test(lower)) return '40plus';
  if (/\b(custom|12\s*week|serious|transform|flagship)\b/.test(lower)) return '12wk';
  if (/\b(trial|zoom|not\s*sure|try|test)\b/.test(lower)) return 'zoom_trial';
  if (/\b(home|no\s*gym|bodyweight|at\s*home)\b/.test(lower)) return '6wk_home';
  return null;
}

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'didnt work',
  'side effect', 'vomit', 'faint', 'heart', 'surgery',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return /\b(stop|unsubscribe|opt\s*out|cancel)\b/.test(lower);
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Flagship Program',
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
  'zoom_pack': 80,
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

module.exports = {
  detectMarket,
  classifyIntent,
  needsEscalation,
  isOptOut,
  PROGRAM_NAMES,
  PROGRAM_PRICES,
  jsonResponse,
  corsHeaders,
};
