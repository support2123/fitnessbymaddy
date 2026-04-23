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

  if (/pcos|hormonal|period|irregular/.test(lower)) return 'pcos';
  if (/40\+?|forty|menopause|joints|joint pain/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|personali[sz]ed/.test(lower)) return '12wk';
  if (/fat\s*loss|weight|shred|burn|lean|cut/.test(lower)) return '6wk_gym';
  if (/home|no\s*gym|bodyweight/.test(lower)) return '6wk_home';
  if (/trial|zoom|not sure|try|test/.test(lower)) return 'zoom_trial';

  return null;
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Session Pack'
};

const PROGRAM_PRICES = {
  '6wk_gym': 97,
  '6wk_home': 97,
  '12wk': 200,
  'pcos': 45,
  '40plus': 50,
  'zoom_trial': 20,
  'zoom_pack': 80
};

const PROGRAM_DURATIONS_WEEKS = {
  '6wk_gym': 6,
  '6wk_home': 6,
  '12wk': 12,
  'pcos': 6,
  '40plus': 8,
  'zoom_trial': 1,
  'zoom_pack': 4
};

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex',
  'bulimi', 'purge', 'faint'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel messages'].includes(lower);
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body) return resolve(req.body);
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
  });
}

module.exports = {
  detectMarket,
  maskPhone,
  detectProgram,
  needsEscalation,
  isOptOut,
  corsHeaders,
  parseBody,
  PROGRAM_NAMES,
  PROGRAM_PRICES,
  PROGRAM_DURATIONS_WEEKS
};
