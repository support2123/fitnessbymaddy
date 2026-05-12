function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

function classifyIntent(message) {
  const lower = (message || '').toLowerCase();

  const patterns = {
    '6wk_gym': /fat\s*loss|weight\s*loss|shred|lean|cut|burn|slim/,
    'pcos': /pcos|hormonal|hormone|irregular\s*period|thyroid/,
    '40plus': /40\+?|forty|menopause|joint|joints|senior|aging/,
    '12wk': /custom|12\s*week|serious|flagship|personalised|personalized|transform/,
    'zoom_trial': /trial|zoom|not\s*sure|try|test|sample|unsure|\$20|20\s*dollar/,
  };

  for (const [program, regex] of Object.entries(patterns)) {
    if (regex.test(lower)) return program;
  }
  return null;
}

function programDisplayName(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack',
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
    'zoom_pack': 150,
  };
  return map[code] || 0;
}

function programWeeks(code) {
  const map = {
    '6wk_gym': 6,
    '6wk_home': 6,
    '12wk': 12,
    'pcos': 6,
    '40plus': 8,
    'zoom_trial': 1,
    'zoom_pack': 4,
  };
  return map[code] || 6;
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'injured', 'medical', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia', 'bulimia',
  'not eating', 'faint', 'fainting', 'chest pain', 'heart',
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'].includes(lower);
}

function isHinglish(market) {
  return market === 'IN';
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
  detectMarket, maskPhone, classifyIntent, programDisplayName,
  programPrice, programWeeks, needsEscalation, isOptOut,
  isHinglish, cors, parseBody, ESCALATION_KEYWORDS,
};
