const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'not eating',
];

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'lean', 'fat'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', 'over 40'],
  '12wk': ['custom', '12 week', 'serious', 'advanced', 'flagship', 'transform'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'demo'],
};

const PROGRAM_DETAILS = {
  '6wk_gym': { name: '6-Week Burn & Build', price: 97, slug: '6wk-burn-build' },
  '6wk_home': { name: '6-Week Home Burn', price: 79, slug: '6wk-home' },
  'pcos': { name: 'PCOS Warrior', price: 45, slug: 'pcos-warrior' },
  '40plus': { name: '40+ Strong', price: 50, slug: '40plus-strong' },
  '12wk': { name: '12-Week Flagship', price: 200, slug: '12wk-flagship' },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20, slug: 'zoom-trial' },
  'zoom_pack': { name: 'Zoom 4-Pack', price: 70, slug: 'zoom-4pack' },
};

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function detectProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return program;
    }
  }
  return null;
}

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'].includes(lower);
}

function getLanguage(market) {
  return market === 'IN' ? 'hinglish' : 'english';
}

function generateToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) return resolve(req.body);
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

module.exports = {
  ESCALATION_KEYWORDS,
  PROGRAM_KEYWORDS,
  PROGRAM_DETAILS,
  detectMarket,
  detectProgram,
  needsEscalation,
  isOptOut,
  getLanguage,
  generateToken,
  cors,
  parseBody,
};
