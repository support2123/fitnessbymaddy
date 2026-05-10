const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'medical', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'purging', 'not eating',
];

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'lose fat', 'slim'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40', 'menopause', 'joints', 'joint pain', 'over 40', '40+', 'forty'],
  '12wk': ['custom', '12 week', 'serious', 'flagship', 'personalised', 'personalized', 'transform'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test'],
};

const PROGRAM_PRICES = {
  '6wk_gym': 97,
  '6wk_home': 97,
  'pcos': 45,
  '40plus': 50,
  '12wk': 200,
  'zoom_trial': 20,
  'zoom_pack': 150,
};

const PROGRAM_DURATIONS_WEEKS = {
  '6wk_gym': 6,
  '6wk_home': 6,
  'pcos': 6,
  '40plus': 6,
  '12wk': 12,
  'zoom_trial': 1,
  'zoom_pack': 8,
};

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel messages'];

function detectProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return program;
    }
  }
  return null;
}

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return STOP_WORDS.some(w => lower === w || lower.includes(w));
}

function isHinglish(market) {
  return market === 'IN';
}

function generateToken(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < (length || 32); i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function weeksBetween(d1, d2) {
  const ms = Math.abs(new Date(d2) - new Date(d1));
  return Math.floor(ms / (7 * 24 * 60 * 60 * 1000));
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
      catch { resolve(data); }
    });
    req.on('error', reject);
  });
}

module.exports = {
  ESCALATION_KEYWORDS,
  PROGRAM_PRICES,
  PROGRAM_DURATIONS_WEEKS,
  detectProgram,
  needsEscalation,
  isOptOut,
  isHinglish,
  generateToken,
  weeksBetween,
  cors,
  parseBody,
};
