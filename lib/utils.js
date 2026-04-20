function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  if (/\b(stop|unsubscribe|opt.?out|cancel)\b/.test(lower)) return 'OPTOUT';

  if (/\b(fat.?loss|weight|shred|slim|lean|lose)\b/.test(lower)) return '6wk_gym';
  if (/\b(pcos|hormonal|irregular|thyroid)\b/.test(lower)) return 'pcos';
  if (/\b(40|forty|menopause|joints|senior|age)\b/.test(lower)) return '40plus';
  if (/\b(custom|12.?week|serious|transform|flagship)\b/.test(lower)) return '12wk';
  if (/\b(trial|zoom|not sure|try|test|sample)\b/.test(lower)) return 'zoom_trial';
  if (/\b(home|bodyweight|no.?gym|apartment)\b/.test(lower)) return '6wk_home';
  if (/\b(gym|strength|muscle|build|bulk)\b/.test(lower)) return '6wk_gym';

  return null;
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'injured', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder', 'purge',
  'binge', 'starving', 'not eating', 'chest pain', 'heart'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function programLabel(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack'
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
    'zoom_pack': 80
  };
  return map[code] || 0;
}

function calculateEndDate(startDate, program) {
  const weeks = program === '12wk' ? 12 : 6;
  const end = new Date(startDate);
  end.setDate(end.getDate() + weeks * 7);
  return end.toISOString();
}

function currentWeekNo(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return Math.max(1, diffWeeks + 1);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

function jsonResponse(res, statusCode, data) {
  res.setHeader('Content-Type', 'application/json');
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  res.status(statusCode).json(data);
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglish,
  classifyIntent,
  needsEscalation,
  programLabel,
  programPrice,
  calculateEndDate,
  currentWeekNo,
  corsHeaders,
  jsonResponse,
  ESCALATION_KEYWORDS
};
