function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const clean = phone.replace(/\D/g, '');
  if (clean.startsWith('91')) return 'IN';
  if (clean.startsWith('971')) return 'UAE';
  if (clean.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function routeProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/fat\s*loss|weight|shred|burn|slim|lean/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|pcod|period|irregular/.test(lower)) return 'pcos';
  if (/40|menopause|joints|senior|mature/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|transform|flagship/.test(lower)) return '12wk';
  if (/home|no\s*gym|bodyweight|at\s*home/.test(lower)) return '6wk_home';
  if (/trial|zoom|not\s*sure|try|test/.test(lower)) return 'zoom_trial';

  return null;
}

const PROGRAM_META = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 97, weeks: 6 },
  '6wk_home': { name: '6-Week Burn & Build (Home)', price: 97, weeks: 6 },
  '12wk': { name: '12-Week Custom Flagship', price: 200, weeks: 12 },
  pcos: { name: 'PCOS Warrior', price: 45, weeks: 8 },
  '40plus': { name: '40+ Strong', price: 50, weeks: 8 },
  zoom_trial: { name: 'Zoom Trial Session', price: 20, weeks: 1 },
  zoom_pack: { name: 'Zoom Session Pack', price: 120, weeks: 8 },
};

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'not eating',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'].includes(lower);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function weekNumber(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
}

module.exports = {
  detectMarket,
  routeProgram,
  PROGRAM_META,
  ESCALATION_KEYWORDS,
  needsEscalation,
  isOptOut,
  corsHeaders,
  jsonResponse,
  weekNumber,
};
