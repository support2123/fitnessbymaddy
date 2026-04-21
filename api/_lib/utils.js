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

function isHinglish(market) {
  return market === 'IN';
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'not eating', 'vomit',
  'heart', 'surgery', 'doctor said'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'optout'].includes(lower);
}

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'lean', 'fat'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', 'over 40'],
  '12wk': ['custom', '12 week', '12-week', 'serious', 'flagship', 'full program'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test']
};

function detectProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior',
  '40plus': '40+ Strong',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Pack'
};

const PROGRAM_PRICES = {
  '6wk_gym': 97,
  '6wk_home': 97,
  '12wk': 200,
  'pcos': 45,
  '40plus': 50,
  'zoom_trial': 20,
  'zoom_pack': 150
};

function programDurationWeeks(program) {
  if (program === '12wk') return 12;
  if (program?.startsWith('6wk')) return 6;
  if (program === 'pcos' || program === '40plus') return 8;
  if (program === 'zoom_trial') return 1;
  if (program === 'zoom_pack') return 8;
  return 6;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  };
}

function jsonResponse(res, data, status = 200) {
  res.status(status).json(data);
}

function errorResponse(res, message, status = 400) {
  res.status(status).json({ error: message });
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglish,
  needsEscalation,
  isOptOut,
  detectProgram,
  PROGRAM_NAMES,
  PROGRAM_PRICES,
  programDurationWeeks,
  corsHeaders,
  jsonResponse,
  errorResponse
};
