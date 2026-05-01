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

  const stopWords = ['stop', 'unsubscribe', 'opt out', 'optout'];
  if (stopWords.some(w => lower.includes(w))) return 'STOP';

  const escalationWords = [
    'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
    'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
    'dizzy', 'dizziness', 'eating disorder', 'anorexia', 'bulimia'
  ];
  if (escalationWords.some(w => lower.includes(w))) return 'ESCALATE';

  if (/fat\s*loss|weight|shred|lean|cut/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone/.test(lower)) return 'pcos';
  if (/\b40\b|menopause|joints|joint\s*pain|mature/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|transform/.test(lower)) return '12wk';
  if (/trial|zoom|not\s*sure|try/.test(lower)) return 'zoom_trial';
  if (/home|bodyweight|no\s*gym/.test(lower)) return '6wk_home';

  return null;
}

function programLabel(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': '$20 Zoom Trial Session',
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
    'zoom_pack': 150
  };
  return map[code] || 0;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function jsonResponse(res, status, body) {
  cors(res);
  res.status(status).json(body);
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglish,
  classifyIntent,
  programLabel,
  programPrice,
  cors,
  jsonResponse
};
