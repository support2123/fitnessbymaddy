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

function isHinglishMarket(market) {
  return market === 'IN';
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'bulimia',
  'anorexia', 'vomit', 'faint',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/fat\s*loss|weight|shred|lose/i.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone/i.test(lower)) return 'pcos';
  if (/40|menopause|joints|joint/i.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship/i.test(lower)) return '12wk';
  if (/trial|zoom|not sure|try/i.test(lower)) return 'zoom_trial';
  if (/home|bodyweight|no gym/i.test(lower)) return '6wk_home';
  if (/stop|unsubscribe|opt.?out/i.test(lower)) return 'STOP';
  return null;
}

const PROGRAM_INFO = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 97 },
  '6wk_home': { name: '6-Week Burn & Build (Home)', price: 97 },
  '12wk': { name: '12-Week Custom Flagship', price: 200 },
  'pcos': { name: 'PCOS Warrior Program', price: 45 },
  '40plus': { name: '40+ Strong Program', price: 50 },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20 },
  'zoom_pack': { name: 'Zoom Session Pack', price: 80 },
};

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

module.exports = {
  maskPhone,
  detectMarket,
  isHinglishMarket,
  needsEscalation,
  classifyIntent,
  PROGRAM_INFO,
  corsHeaders,
  jsonResponse,
};
