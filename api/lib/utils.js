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

function detectProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/fat\s*loss|weight|shred|burn/i.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone/i.test(lower)) return 'pcos';
  if (/40\+?|forty|menopause|joints|joint/i.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|transform/i.test(lower)) return '12wk';
  if (/trial|zoom|not\s*sure|try/i.test(lower)) return 'zoom_trial';
  if (/home/i.test(lower)) return '6wk_home';
  return null;
}

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'not working', 'worse', 'hospital'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}

function programLabel(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Training',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack'
  };
  return map[code] || code;
}

function programPrice(code) {
  const map = {
    '6wk_gym': 97, '6wk_home': 97, '12wk': 200,
    'pcos': 45, '40plus': 50, 'zoom_trial': 20, 'zoom_pack': 80
  };
  return map[code] || 0;
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

module.exports = {
  maskPhone, detectMarket, isHinglishMarket, detectProgram,
  needsEscalation, isOptOut, programLabel, programPrice, corsHeaders
};
