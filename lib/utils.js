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

function isHinglishMarket(market) {
  return market === 'IN';
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  if (/\b(stop|unsubscribe|opt.?out|remove)\b/.test(lower)) return 'OPTOUT';

  const escalationKeywords = [
    'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
    'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
    'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi'
  ];
  for (const kw of escalationKeywords) {
    if (lower.includes(kw)) return 'ESCALATE';
  }

  if (/\b(fat.?loss|weight|shred|lean|cut)\b/.test(lower)) return '6wk_gym';
  if (/\b(pcos|hormonal|hormone)\b/.test(lower)) return 'pcos';
  if (/\b(40|forty|menopause|joints|joint)\b/.test(lower)) return '40plus';
  if (/\b(custom|12.?week|serious|flagship|transform)\b/.test(lower)) return '12wk';
  if (/\b(trial|zoom|not sure|try|test)\b/.test(lower)) return 'zoom_trial';
  if (/\b(home|no.?gym|bodyweight)\b/.test(lower)) return '6wk_home';

  return null;
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Sessions Pack'
};

const PROGRAM_PRICES = {
  '6wk_gym': 9700,
  '6wk_home': 9700,
  '12wk': 20000,
  'pcos': 4500,
  '40plus': 5000,
  'zoom_trial': 2000,
  'zoom_pack': 15000
};

function programDurationWeeks(program) {
  if (program === '12wk') return 12;
  if (program.startsWith('6wk')) return 6;
  if (program === 'zoom_trial') return 1;
  if (program === 'zoom_pack') return 8;
  return 6;
}

function sendJson(res, status, data) {
  res.status(status).json(data);
}

function sendError(res, status, message) {
  res.status(status).json({ error: message });
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglishMarket,
  classifyIntent,
  PROGRAM_NAMES,
  PROGRAM_PRICES,
  programDurationWeeks,
  sendJson,
  sendError,
  corsHeaders
};
