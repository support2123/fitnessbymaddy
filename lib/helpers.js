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

function classifyIntent(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  if (/stop|unsubscribe|opt.?out/i.test(lower)) return 'OPTOUT';

  const escalationKeywords = [
    'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
    'pain', 'dizz', 'disordered', 'refund', 'lawyer', 'complaint',
    "didn't work", 'didnt work', 'side effect'
  ];
  if (escalationKeywords.some(k => lower.includes(k))) return 'ESCALATE';

  if (/fat.?loss|weight|shred|lose|slim|lean/i.test(lower)) return '6wk';
  if (/pcos|hormonal|hormone|pcod/i.test(lower)) return 'pcos';
  if (/40|forty|menopause|joint|senior/i.test(lower)) return '40plus';
  if (/custom|12.?week|serious|flagship|transform/i.test(lower)) return '12wk';
  if (/trial|zoom|not sure|try|test/i.test(lower)) return 'zoom_trial';

  return null;
}

function programLabel(code) {
  const labels = {
    '6wk': '6-Week Burn & Build',
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    '12wk': '12-Week Custom Flagship',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Pack'
  };
  return labels[code] || code;
}

function programPrice(code) {
  const prices = {
    '6wk': 97,
    '6wk_gym': 97,
    '6wk_home': 97,
    'pcos': 45,
    '40plus': 50,
    '12wk': 200,
    'zoom_trial': 20,
    'zoom_pack': 150
  };
  return prices[code] || 0;
}

function calculateEndDate(startDate, programCode) {
  const weeks = {
    '6wk': 6, '6wk_gym': 6, '6wk_home': 6,
    'pcos': 6, '40plus': 6,
    '12wk': 12,
    'zoom_trial': 1, 'zoom_pack': 8
  };
  const d = new Date(startDate);
  d.setDate(d.getDate() + (weeks[programCode] || 6) * 7);
  return d.toISOString();
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglish,
  classifyIntent,
  programLabel,
  programPrice,
  calculateEndDate,
  cors
};
