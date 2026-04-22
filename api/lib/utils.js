function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'not working', 'scam',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function detectProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/fat\s*loss|weight|shred|slim|lose/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone|period|irregular/.test(lower)) return 'pcos';
  if (/40\+?|forty|menopause|joint|knee|back pain/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|transform/.test(lower)) return '12wk';
  if (/trial|zoom|not sure|try|test|sample/.test(lower)) return 'zoom_trial';
  if (/home|bodyweight|no gym|at home/.test(lower)) return '6wk_home';
  return null;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Session Pack',
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
  if (program.startsWith('6wk')) return 6;
  if (program === 'pcos' || program === '40plus') return 8;
  if (program === 'zoom_trial') return 1;
  if (program === 'zoom_pack') return 4;
  return 6;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function corsResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglish,
  needsEscalation,
  detectProgram,
  isOptOut,
  PROGRAM_NAMES,
  PROGRAM_PRICES,
  programDurationWeeks,
  jsonResponse,
  corsResponse,
};
