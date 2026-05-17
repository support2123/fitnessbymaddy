const crypto = require('crypto');

function detectMarket(phone) {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'shred', 'burn', 'lose weight', 'fat', 'weight'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular period'],
  '40plus': ['40', '40+', 'menopause', 'joints', 'joint pain', 'over 40', 'senior'],
  '12wk': ['custom', '12 week', '12wk', 'serious', 'personalised', 'personalized', 'flagship'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure']
};

function matchProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return program;
    }
  }
  return null;
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

function isOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'].includes(lower);
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'surgery', 'doctor', 'hospital'
];

function checkEscalation(text) {
  const lower = (text || '').toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { shouldEscalate: true, reason: `Message contains: "${keyword}"` };
    }
  }
  return { shouldEscalate: false, reason: null };
}

function getGreeting(market) {
  if (market === 'IN') {
    return "Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?";
  }
  return "Hi! Maddy's team here. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";
}

function getProgramCheckoutUrl(program) {
  const slugs = {
    '6wk_gym': '6-week-shred-gym',
    '6wk_home': '6-week-shred-home',
    '12wk': '12-week-custom',
    'pcos': 'pcos-warrior',
    '40plus': '40-plus-strong',
    'zoom_trial': 'zoom-trial',
    'zoom_pack': 'zoom-pack'
  };
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${slugs[program] || program}`;
}

function getProgramName(program) {
  const names = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack'
  };
  return names[program] || program;
}

module.exports = {
  detectMarket,
  matchProgram,
  maskPhone,
  generateToken,
  isOptOut,
  checkEscalation,
  getGreeting,
  getProgramCheckoutUrl,
  getProgramName
};
