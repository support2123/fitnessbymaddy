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
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex',
  'bulimi', 'faint', 'chest pain', 'heart',
];

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

function classifyIntent(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  if (/stop|unsubscribe|opt.?out/i.test(lower)) return 'OPTOUT';

  if (/fat.?loss|weight|shred|lean|cut/i.test(lower)) return '6wk_gym';
  if (/home|no.?gym|bodyweight|at.?home/i.test(lower)) return '6wk_home';
  if (/pcos|hormonal|period|irregular/i.test(lower)) return 'pcos';
  if (/40|forty|menopause|joint|knee|back.?pain|senior/i.test(lower)) return '40plus';
  if (/custom|12.?week|serious|flagship|transform/i.test(lower)) return '12wk';
  if (/trial|zoom|not.?sure|try|test|sample/i.test(lower)) return 'zoom_trial';

  return null;
}

const PROGRAM_DETAILS = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 97, duration: 42 },
  '6wk_home': { name: '6-Week Burn & Build (Home)', price: 97, duration: 42 },
  '12wk': { name: '12-Week Custom Program', price: 200, duration: 84 },
  pcos: { name: 'PCOS Warrior Program', price: 45, duration: 42 },
  '40plus': { name: '40+ Strong Program', price: 50, duration: 42 },
  zoom_trial: { name: 'Zoom Trial Session', price: 20, duration: 7 },
  zoom_pack: { name: 'Zoom Session Pack', price: 150, duration: 30 },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglish,
  needsEscalation,
  classifyIntent,
  PROGRAM_DETAILS,
  corsHeaders,
};
