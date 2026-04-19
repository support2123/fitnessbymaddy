function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('91') && cleaned.length === 12) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'lean', 'fat', 'lose'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular'],
  '40plus': ['40', '40+', 'menopause', 'joints', 'joint pain', 'senior', 'mature'],
  '12wk': ['custom', '12 week', '12-week', 'serious', 'flagship', 'personalized', 'personalised', 'transform'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'sample']
};

function matchProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return program;
    }
  }
  return null;
}

function programDisplayName(code) {
  const names = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Training',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack'
  };
  return names[code] || code;
}

function programPrice(code) {
  const prices = {
    '6wk_gym': 97,
    '6wk_home': 97,
    '12wk': 200,
    'pcos': 45,
    '40plus': 50,
    'zoom_trial': 20,
    'zoom_pack': 150
  };
  return prices[code] || 0;
}

function weeksBetween(start, end) {
  const ms = new Date(end) - new Date(start);
  return Math.floor(ms / (7 * 24 * 60 * 60 * 1000));
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  };
}

function handleCors(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(200).json({ ok: true });
    return true;
  }
  return false;
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglish,
  matchProgram,
  programDisplayName,
  programPrice,
  weeksBetween,
  corsHeaders,
  handleCors
};
