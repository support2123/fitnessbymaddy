function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
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

function normalizePhone(phone) {
  if (!phone) return '';
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('91') && cleaned.length >= 12) {
      cleaned = '+' + cleaned;
    } else if (cleaned.length === 10) {
      cleaned = '+91' + cleaned;
    } else {
      cleaned = '+' + cleaned;
    }
  }
  return cleaned;
}

function classifyIntent(message) {
  if (!message) return null;
  const lower = message.toLowerCase().trim();

  const stopWords = ['stop', 'unsubscribe', 'opt out', 'optout'];
  if (stopWords.some(w => lower.includes(w))) return 'STOP';

  const escalationWords = [
    'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
    'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
    'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia'
  ];
  if (escalationWords.some(w => lower.includes(w))) return 'ESCALATE';

  const fatLoss = ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lean', 'slim'];
  if (fatLoss.some(w => lower.includes(w))) return '6wk';

  const pcos = ['pcos', 'hormonal', 'hormone', 'pcod'];
  if (pcos.some(w => lower.includes(w))) return 'pcos';

  const fortyPlus = ['40', 'menopause', 'joints', 'joint pain', 'over 40', '40+', 'forty'];
  if (fortyPlus.some(w => lower.includes(w))) return '40plus';

  const custom = ['custom', '12 week', '12-week', 'serious', 'flagship', 'personalised', 'personalized'];
  if (custom.some(w => lower.includes(w))) return '12wk';

  const trial = ['trial', 'zoom', 'not sure', 'try', 'test'];
  if (trial.some(w => lower.includes(w))) return 'zoom_trial';

  return null;
}

const PROGRAM_MAP = {
  '6wk': { name: '6-Week Burn & Build', slug: '6wk_gym', price: 97 },
  'pcos': { name: 'PCOS Warrior', slug: 'pcos', price: 45 },
  '40plus': { name: '40+ Strong', slug: '40plus', price: 50 },
  '12wk': { name: '12-Week Flagship', slug: '12wk', price: 200 },
  'zoom_trial': { name: '$20 Zoom Trial', slug: 'zoom_trial', price: 20 },
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
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}

function handleCors(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  return null;
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglish,
  normalizePhone,
  classifyIntent,
  PROGRAM_MAP,
  jsonResponse,
  corsHeaders,
  handleCors,
};
