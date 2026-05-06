const crypto = require('crypto');

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

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'shred', 'burn', 'lean', 'cut', 'gym'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40+', '40 plus', 'menopause', 'joints', 'joint pain', 'senior', 'over 40'],
  '12wk': ['custom', '12 week', '12wk', 'serious', 'flagship', 'advanced', 'transform'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'demo']
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return program;
    }
  }
  return null;
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'injured', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'surgery', 'doctor said', 'hospital'
];

function isEscalationTrigger(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

const STOP_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel messages'];

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return STOP_KEYWORDS.some(kw => lower.includes(kw));
}

function verifyExlyWebhook(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Exly-Signature');
}

function programDuration(program) {
  const durations = {
    '6wk_gym': 42,
    '6wk_home': 42,
    '12wk': 84,
    'pcos': 42,
    '40plus': 42,
    'zoom_trial': 7,
    'zoom_pack': 28
  };
  return durations[program] || 42;
}

function programPrice(program) {
  const prices = {
    '6wk_gym': 97,
    '6wk_home': 97,
    '12wk': 200,
    'pcos': 45,
    '40plus': 50,
    'zoom_trial': 20,
    'zoom_pack': 80
  };
  return prices[program] || 0;
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglish,
  matchProgram,
  isEscalationTrigger,
  isOptOut,
  verifyExlyWebhook,
  corsHeaders,
  programDuration,
  programPrice
};
