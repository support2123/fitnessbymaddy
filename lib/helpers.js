function detectMarket(phone) {
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function matchProgram(text) {
  const lower = (text || '').toLowerCase();
  if (/fat\s*loss|weight|shred|lean/.test(lower)) return { program: '6wk_gym', name: '6-Week Burn & Build', price: 97 };
  if (/pcos|hormonal|period|irregular/.test(lower)) return { program: 'pcos', name: 'PCOS Warrior', price: 45 };
  if (/40|menopause|joints|senior|mature/.test(lower)) return { program: '40plus', name: '40+ Strong', price: 50 };
  if (/custom|12\s*week|serious|flagship|transform/.test(lower)) return { program: '12wk', name: '12-Week Flagship', price: 200 };
  if (/trial|zoom|not\s*sure|try|test/.test(lower)) return { program: 'zoom_trial', name: 'Zoom Trial Session', price: 20 };
  if (/home|no\s*gym|bodyweight/.test(lower)) return { program: '6wk_home', name: '6-Week Home Program', price: 97 };
  return null;
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'bulimia', 'anorexia',
  'not eating', 'faint', 'chest pain', 'heart',
];

function needsEscalation(text) {
  const lower = (text || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'].includes(lower);
}

function programWeeks(program) {
  if (program === '12wk') return 12;
  if (program?.startsWith('6wk')) return 6;
  if (program === 'pcos' || program === '40plus') return 6;
  return 4;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

module.exports = { detectMarket, maskPhone, matchProgram, needsEscalation, isOptOut, programWeeks, cors };
