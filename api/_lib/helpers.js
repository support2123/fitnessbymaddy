function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
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

  if (/\b(stop|unsubscribe|opt.?out)\b/.test(lower)) return 'OPTOUT';

  const escalationWords = ['refund', 'lawyer', 'complaint', "didn't work", 'side effect',
    'injury', 'medical', 'pregnant', 'pregnancy', 'medication', 'pain',
    'dizziness', 'dizzy', 'eating disorder', 'not eating', 'purge', 'vomit'];
  for (const word of escalationWords) {
    if (lower.includes(word)) return 'ESCALATE';
  }

  if (/\b(fat.?loss|weight|shred|lose|slim)\b/.test(lower)) return '6wk';
  if (/\b(pcos|hormonal|hormone)\b/.test(lower)) return 'pcos';
  if (/\b(40|forty|menopause|joints|joint)\b/.test(lower)) return '40plus';
  if (/\b(custom|12.?week|serious|flagship|transform)\b/.test(lower)) return '12wk';
  if (/\b(trial|zoom|not sure|try|test)\b/.test(lower)) return 'trial';

  return null;
}

const PROGRAM_MAP = {
  '6wk': { name: '6-Week Burn & Build', price: 97, key: '6wk_gym' },
  'pcos': { name: 'PCOS Warrior', price: 45, key: 'pcos' },
  '40plus': { name: '40+ Strong', price: 50, key: '40plus' },
  '12wk': { name: '12-Week Flagship', price: 200, key: '12wk' },
  'trial': { name: 'Zoom Trial', price: 20, key: 'zoom_trial' }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

function jsonResponse(res, status, data) {
  res.status(status).json(data);
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglish,
  classifyIntent,
  PROGRAM_MAP,
  corsHeaders,
  jsonResponse
};
