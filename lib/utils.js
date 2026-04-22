const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorex', 'bulimi',
  'not eating', 'throwing up',
];

const STOP_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout'];

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'lose fat', 'burn', 'slim'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
  '40plus': ['40', 'menopause', 'joints', 'joint pain', 'senior', 'over 40'],
  '12wk': ['custom', '12 week', '12wk', 'serious', 'transform', 'flagship', 'personali'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test'],
};

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (STOP_KEYWORDS.some(k => lower.includes(k))) return { type: 'stop' };
  if (ESCALATION_KEYWORDS.some(k => lower.includes(k))) return { type: 'escalate', keyword: ESCALATION_KEYWORDS.find(k => lower.includes(k)) };

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return { type: 'program', program };
  }

  return { type: 'unknown' };
}

function getProgramLabel(code) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Training',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack',
  };
  return labels[code] || code;
}

function getProgramPrice(code) {
  const prices = {
    '6wk_gym': 97,
    '6wk_home': 97,
    '12wk': 200,
    'pcos': 45,
    '40plus': 50,
    'zoom_trial': 20,
    'zoom_pack': 150,
  };
  return prices[code] || 0;
}

function getProgramWeeks(code) {
  const weeks = {
    '6wk_gym': 6,
    '6wk_home': 6,
    '12wk': 12,
    'pcos': 6,
    '40plus': 8,
    'zoom_trial': 1,
    'zoom_pack': 8,
  };
  return weeks[code] || 6;
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

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = {
  classifyIntent,
  getProgramLabel,
  getProgramPrice,
  getProgramWeeks,
  parseBody,
  cors,
  ESCALATION_KEYWORDS,
  STOP_KEYWORDS,
};
