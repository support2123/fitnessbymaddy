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

function classifyIntent(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  const escalationKeywords = [
    'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
    'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia', 'bulimia',
    'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  ];
  for (const kw of escalationKeywords) {
    if (lower.includes(kw)) return { type: 'escalation', keyword: kw };
  }

  if (/stop|unsubscribe/i.test(lower)) return { type: 'optout' };

  if (/fat\s*loss|weight|shred/i.test(lower)) return { type: 'program', program: '6wk_gym' };
  if (/pcos|hormonal/i.test(lower)) return { type: 'program', program: 'pcos' };
  if (/40|menopause|joints/i.test(lower)) return { type: 'program', program: '40plus' };
  if (/custom|12\s*week|serious/i.test(lower)) return { type: 'program', program: '12wk' };
  if (/trial|zoom|not\s*sure/i.test(lower)) return { type: 'program', program: 'zoom_trial' };

  return { type: 'unknown' };
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior',
  '40plus': '40+ Strong',
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

function programDurationWeeks(program) {
  if (program === '12wk') return 12;
  if (program === 'zoom_trial') return 1;
  if (program === 'zoom_pack') return 4;
  return 6;
}

function json(res, data, status = 200) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).json(data);
}

function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

module.exports = {
  detectMarket,
  maskPhone,
  classifyIntent,
  PROGRAM_NAMES,
  PROGRAM_PRICES,
  programDurationWeeks,
  json,
  cors,
};
