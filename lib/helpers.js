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
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/fat\s*loss|weight|shred|lean|cut/i.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|period|irregular/i.test(lower)) return 'pcos';
  if (/40|menopause|joints|senior|mature/i.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|transform/i.test(lower)) return '12wk';
  if (/trial|zoom|not\s*sure|try|test/i.test(lower)) return 'zoom_trial';
  if (/home|bodyweight|no\s*gym/i.test(lower)) return '6wk_home';
  return null;
}

function programLabel(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Pack'
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
    'zoom_pack': 80
  };
  return map[code] || 0;
}

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'vomit', 'faint', 'chest pain', 'heart'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) return resolve(req.body);
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(data);
      }
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
  detectMarket,
  maskPhone,
  detectProgram,
  programLabel,
  programPrice,
  needsEscalation,
  isOptOut,
  parseBody,
  cors
};
