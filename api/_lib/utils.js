function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('91') || cleaned.startsWith('091')) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

function cleanPhone(phone) {
  if (!phone) return '';
  return phone.replace(/[^0-9+]/g, '');
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function handleCors(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'purging', 'faint', 'chest pain', 'heart'
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout'];

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lean', 'burn', 'cut'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'pcod'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', 'over 40'],
  '12wk': ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test']
};

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
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(kw => lower === kw || lower.includes(kw));
}

function programLabel(code) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack'
  };
  return labels[code] || code;
}

function weeksBetween(start, end) {
  const ms = new Date(end) - new Date(start);
  return Math.floor(ms / (7 * 24 * 60 * 60 * 1000));
}

module.exports = {
  maskPhone, detectMarket, isHinglish, cleanPhone,
  handleCors, corsHeaders, detectProgram, needsEscalation,
  isOptOut, programLabel, weeksBetween,
  ESCALATION_KEYWORDS, OPT_OUT_KEYWORDS
};
