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

function isHinglishMarket(market) {
  return market === 'IN';
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex',
  'bulimi', 'not eating', 'medical',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/stop|unsubscribe|opt.?out/i.test(lower)) return 'OPTOUT';

  if (/fat.?loss|weight|shred|lean|slim|burn/i.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|period|irregular/i.test(lower)) return 'pcos';
  if (/40\+?|forty|menopause|joints|joint pain|senior/i.test(lower)) return '40plus';
  if (/custom|12.?week|serious|flagship|personali/i.test(lower)) return '12wk';
  if (/trial|zoom|not sure|try|test/i.test(lower)) return 'zoom_trial';
  if (/home|no.?gym|bodyweight|at home/i.test(lower)) return '6wk_home';
  if (/gym|muscle|strength|bulk|gain/i.test(lower)) return '6wk_gym';

  return null;
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Pack',
};

const PROGRAM_PRICES = {
  '6wk_gym': 97,
  '6wk_home': 97,
  '12wk': 200,
  'pcos': 45,
  '40plus': 50,
  'zoom_trial': 20,
  'zoom_pack': 80,
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://fitnessbymaddy.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglishMarket,
  needsEscalation,
  classifyIntent,
  PROGRAM_NAMES,
  PROGRAM_PRICES,
  cors,
};
