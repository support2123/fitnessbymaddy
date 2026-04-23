const crypto = require('crypto');

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

function classifyIntent(message) {
  if (!message) return null;
  const msg = message.toLowerCase();

  const ESCALATION_KEYWORDS = [
    'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
    'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
    'dizzy', 'dizziness', 'eating disorder', 'not eating',
    'medical condition', 'surgery', 'doctor said',
  ];

  for (const kw of ESCALATION_KEYWORDS) {
    if (msg.includes(kw)) return { type: 'escalation', keyword: kw };
  }

  if (/\b(stop|unsubscribe)\b/i.test(msg)) {
    return { type: 'optout' };
  }

  if (/\b(fat\s*loss|weight|shred|lose)\b/i.test(msg)) {
    return { type: 'program', program: '6wk_gym', name: '6-Week Burn & Build' };
  }
  if (/\b(pcos|hormonal|hormone)\b/i.test(msg)) {
    return { type: 'program', program: 'pcos', name: 'PCOS Warrior' };
  }
  if (/\b(40|forty|menopause|joints|joint)\b/i.test(msg)) {
    return { type: 'program', program: '40plus', name: '40+ Strong' };
  }
  if (/\b(custom|12\s*week|serious|flagship)\b/i.test(msg)) {
    return { type: 'program', program: '12wk', name: '12-Week Flagship' };
  }
  if (/\b(trial|zoom|not\s*sure|try)\b/i.test(msg)) {
    return { type: 'program', program: 'zoom_trial', name: 'Zoom Trial' };
  }
  if (/\b(home|no\s*gym|bodyweight)\b/i.test(msg)) {
    return { type: 'program', program: '6wk_home', name: '6-Week Home Program' };
  }

  return null;
}

function programPrice(program) {
  const prices = {
    '6wk_gym': 97,
    '6wk_home': 97,
    '12wk': 200,
    'pcos': 45,
    '40plus': 50,
    'zoom_trial': 20,
    'zoom_pack': 80,
  };
  return prices[program] || 0;
}

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
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

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

module.exports = {
  detectMarket,
  maskPhone,
  classifyIntent,
  programPrice,
  generateToken,
  corsHeaders,
  jsonResponse,
  errorResponse,
};
