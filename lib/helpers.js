function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const clean = phone.replace(/[^0-9+]/g, '');
  if (clean.startsWith('+91') || clean.startsWith('91')) return 'IN';
  if (clean.startsWith('+971') || clean.startsWith('971')) return 'UAE';
  if (clean.startsWith('+44') || clean.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

function isHinglish(market) {
  return market === 'IN';
}

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'purge', 'binge', 'refund', 'lawyer', 'complaint',
  "didn't work", 'didnt work', 'side effect', 'side effects'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/\b(stop|unsubscribe|opt.?out)\b/.test(lower)) return 'optout';

  if (/\b(fat.?loss|weight|shred|burn|slim|lean)\b/.test(lower)) return '6wk';
  if (/\b(pcos|hormonal|hormone|period|irregular)\b/.test(lower)) return 'pcos';
  if (/\b(40|forty|menopause|joints|joint|senior|age)\b/.test(lower)) return '40plus';
  if (/\b(custom|12.?week|serious|flagship|transform)\b/.test(lower)) return '12wk';
  if (/\b(trial|zoom|not sure|unsure|try|test)\b/.test(lower)) return 'zoom_trial';

  return null;
}

function programLabel(code) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '6wk': '6-Week Burn & Build',
    '12wk': '12-Week Custom Program',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack'
  };
  return labels[code] || code;
}

function programPrice(code) {
  const prices = {
    '6wk_gym': 97, '6wk_home': 97, '6wk': 97,
    '12wk': 200, 'pcos': 45, '40plus': 50,
    'zoom_trial': 20, 'zoom_pack': 80
  };
  return prices[code] || 0;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

module.exports = {
  detectMarket, maskPhone, isHinglish, needsEscalation,
  classifyIntent, programLabel, programPrice, cors
};
