function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'not eating', 'fainted', 'hospital',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/stop|unsubscribe|opt.?out/i.test(lower)) return 'OPTOUT';

  if (/fat.?loss|weight|shred|lean|slim|lose/i.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone|pcod/i.test(lower)) return 'pcos';
  if (/40\+?|forty|menopause|joint|knee|back pain/i.test(lower)) return '40plus';
  if (/custom|12.?week|serious|transform|flagship/i.test(lower)) return '12wk';
  if (/home|no.?gym|bodyweight|at.?home/i.test(lower)) return '6wk_home';
  if (/trial|zoom|not sure|try|test/i.test(lower)) return 'zoom_trial';

  return null;
}

const PROGRAM_META = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 97, weeks: 6 },
  '6wk_home': { name: '6-Week Burn & Build (Home)', price: 97, weeks: 6 },
  '12wk': { name: '12-Week Flagship Transform', price: 200, weeks: 12 },
  'pcos': { name: 'PCOS Warrior Program', price: 45, weeks: 6 },
  '40plus': { name: '40+ Strong Program', price: 50, weeks: 6 },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20, weeks: 1 },
  'zoom_pack': { name: 'Zoom Pack (4 sessions)', price: 70, weeks: 4 },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function sanitizeInput(str) {
  if (!str) return '';
  return String(str).replace(/[<>]/g, '').trim().slice(0, 2000);
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglish,
  needsEscalation,
  classifyIntent,
  PROGRAM_META,
  corsHeaders,
  jsonResponse,
  sanitizeInput,
};
