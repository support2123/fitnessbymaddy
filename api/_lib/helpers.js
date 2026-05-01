function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.substring(0, 4) + 'XXX...' + phone.slice(-3);
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
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'not eating',
  'medical condition', 'doctor said'
];

function needsEscalation(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'opt-out'];

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return OPT_OUT_KEYWORDS.some(kw => lower === kw || lower.includes(kw));
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/fat\s*loss|weight\s*(loss)?|shred|slim|lean|cut/i.test(lower)) {
    return { program: '6wk_gym', label: '6-Week Burn & Build' };
  }
  if (/pcos|hormonal|hormone|period|irregular/i.test(lower)) {
    return { program: 'pcos', label: 'PCOS Warrior' };
  }
  if (/40\+?|forty|menopause|joints|senior|mature/i.test(lower)) {
    return { program: '40plus', label: '40+ Strong' };
  }
  if (/custom|12\s*week|serious|flagship|personal/i.test(lower)) {
    return { program: '12wk', label: '12-Week Custom Training' };
  }
  if (/trial|zoom|not sure|try|test/i.test(lower)) {
    return { program: 'zoom_trial', label: 'Zoom Trial' };
  }
  if (/home|no gym|bodyweight|at home/i.test(lower)) {
    return { program: '6wk_home', label: '6-Week Home Shred' };
  }

  return null;
}

function programPrice(program) {
  const prices = {
    '6wk_gym': 9700,
    '6wk_home': 9700,
    '12wk': 20000,
    'pcos': 4500,
    '40plus': 5000,
    'zoom_trial': 2000,
    'zoom_pack': 15000
  };
  return prices[program] || 0;
}

function programDurationDays(program) {
  const durations = {
    '6wk_gym': 42,
    '6wk_home': 42,
    '12wk': 84,
    'pcos': 42,
    '40plus': 42,
    'zoom_trial': 7,
    'zoom_pack': 84
  };
  return durations[program] || 42;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
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
  maskPhone,
  detectMarket,
  isHinglishMarket,
  needsEscalation,
  isOptOut,
  classifyIntent,
  programPrice,
  programDurationDays,
  cors,
  parseBody,
  ESCALATION_KEYWORDS
};
