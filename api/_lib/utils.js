function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('91') || cleaned.startsWith('091')) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

function isHinglishMarket(market) {
  return market === 'IN';
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
  'not eating', 'faint', 'hospital'
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
  if (/\b(fat.?loss|weight|shred|lean|cut)\b/.test(lower)) return '6wk';
  if (/\b(pcos|hormonal|hormone)\b/.test(lower)) return 'pcos';
  if (/\b(40|forty|menopause|joints|senior)\b/.test(lower)) return '40plus';
  if (/\b(custom|12.?week|serious|flagship|transform)\b/.test(lower)) return '12wk';
  if (/\b(trial|zoom|not sure|try|test)\b/.test(lower)) return 'zoom_trial';
  if (/\b(home|bodyweight|no.?gym)\b/.test(lower)) return '6wk_home';
  if (/\b(gym|lifting|strength)\b/.test(lower)) return '6wk_gym';
  return null;
}

const PROGRAM_INFO = {
  '6wk': { name: '6-Week Burn & Build (Gym)', price: 97, slug: '6wk_gym', checkoutPath: 'shred' },
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 97, slug: '6wk_gym', checkoutPath: 'shred' },
  '6wk_home': { name: '6-Week Burn & Build (Home)', price: 97, slug: '6wk_home', checkoutPath: 'shred' },
  'pcos': { name: 'PCOS Warrior Program', price: 45, slug: 'pcos', checkoutPath: 'pcos' },
  '40plus': { name: '40+ Strong Program', price: 50, slug: '40plus', checkoutPath: '40plus' },
  '12wk': { name: '12-Week Custom Training', price: 200, slug: '12wk', checkoutPath: 'custom' },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20, slug: 'zoom_trial', checkoutPath: 'trial' },
  'zoom_pack': { name: 'Zoom Pack', price: 80, slug: 'zoom_pack', checkoutPath: 'zoom-pack' },
};

function getProgramInfo(key) {
  return PROGRAM_INFO[key] || null;
}

function parseFormData(body) {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      const params = new URLSearchParams(body);
      const obj = {};
      for (const [k, v] of params) obj[k] = v;
      return obj;
    }
  }
  return body || {};
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}

function jsonResponse(res, data, status = 200) {
  res.status(status).json(data);
}

function errorResponse(res, message, status = 400) {
  res.status(status).json({ error: message });
}

module.exports = {
  detectMarket,
  maskPhone,
  isHinglishMarket,
  needsEscalation,
  classifyIntent,
  getProgramInfo,
  PROGRAM_INFO,
  parseFormData,
  corsHeaders,
  jsonResponse,
  errorResponse,
};
