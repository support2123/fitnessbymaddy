function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/\b(stop|unsubscribe|opt.?out)\b/.test(lower)) return 'OPT_OUT';

  const escalation = [
    'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
    'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
    'dizziness', 'dizzy', 'eating disorder', 'anorex', 'bulimi',
    'medical condition'
  ];
  if (escalation.some(kw => lower.includes(kw))) return 'ESCALATE';

  if (/\b(fat.?loss|weight|shred|lean|cut)\b/.test(lower)) return 'PROGRAM_6WK';
  if (/\b(pcos|hormonal|hormone)\b/.test(lower)) return 'PROGRAM_PCOS';
  if (/\b(40|forty|menopause|joints?|senior)\b/.test(lower)) return 'PROGRAM_40PLUS';
  if (/\b(custom|12.?week|serious|flagship|transform)\b/.test(lower)) return 'PROGRAM_12WK';
  if (/\b(trial|zoom|not sure|try|sample)\b/.test(lower)) return 'PROGRAM_TRIAL';

  return null;
}

function programLabel(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Program',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Pack',
  };
  return map[code] || code;
}

function programFromIntent(intent) {
  const map = {
    PROGRAM_6WK: '6wk_gym',
    PROGRAM_PCOS: 'pcos',
    PROGRAM_40PLUS: '40plus',
    PROGRAM_12WK: '12wk',
    PROGRAM_TRIAL: 'zoom_trial',
  };
  return map[intent] || null;
}

function json(res, data, status = 200) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).json(data);
}

function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

module.exports = {
  detectMarket,
  maskPhone,
  classifyIntent,
  programLabel,
  programFromIntent,
  json,
  cors,
};
