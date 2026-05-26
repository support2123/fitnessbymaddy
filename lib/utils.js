function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
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

function handleOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function normalizePhone(phone) {
  let cleaned = phone.replace(/[\s\-()]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.length === 10) cleaned = '+91' + cleaned;
    else cleaned = '+' + cleaned;
  }
  return cleaned;
}

function routeProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/fat\s*loss|weight|shred|lean|burn|cut/i.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone|period|irregular/i.test(lower)) return 'pcos';
  if (/40\+?|forty|menopause|joints|senior|aging/i.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|premium/i.test(lower)) return '12wk';
  if (/home|no\s*gym|bodyweight|at\s*home/i.test(lower)) return '6wk_home';
  if (/trial|zoom|not\s*sure|try|sample/i.test(lower)) return 'zoom_trial';

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
  'pcos': 6,
  '40plus': 8,
  'zoom_trial': 1,
  'zoom_pack': 8
};

module.exports = {
  corsHeaders, jsonResponse, errorResponse, handleOptions,
  normalizePhone, routeProgram,
  PROGRAM_NAMES, PROGRAM_PRICES, PROGRAM_DURATIONS_WEEKS
};
