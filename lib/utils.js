function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  const p = phone.replace(/[^0-9+]/g, '');
  if (p.startsWith('+91') || p.startsWith('91')) return 'IN';
  if (p.startsWith('+971') || p.startsWith('971')) return 'UAE';
  if (p.startsWith('+44') || p.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function normalizePhone(phone) {
  let p = phone.replace(/[^0-9+]/g, '');
  if (!p.startsWith('+')) p = '+' + p;
  return p;
}

function routeToProgram(message) {
  const msg = message.toLowerCase();
  if (/fat\s*loss|weight|shred|lean|slim/.test(msg))
    return { program: '6wk_gym', name: '6-Week Burn & Build', price: 97, checkout: '6wk-burn-build' };
  if (/pcos|hormonal|hormone/.test(msg))
    return { program: 'pcos', name: 'PCOS Warrior', price: 45, checkout: 'pcos-warrior' };
  if (/40|menopause|joints|senior|mature/.test(msg))
    return { program: '40plus', name: '40+ Strong', price: 50, checkout: '40plus-strong' };
  if (/custom|12\s*week|serious|flagship|transform|full/.test(msg))
    return { program: '12wk', name: '12-Week Flagship', price: 200, checkout: '12wk-flagship' };
  if (/trial|zoom|not\s*sure|try|test/.test(msg))
    return { program: 'zoom_trial', name: 'Zoom Trial', price: 20, checkout: 'zoom-trial' };
  return null;
}

const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex', 'bulimi',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'hurt', 'hospital', 'surgery', 'doctor', 'disabled'
];

function needsEscalation(message) {
  const msg = message.toLowerCase();
  return ESCALATION_KEYWORDS.find(t => msg.includes(t)) || null;
}

function needsOptOut(message) {
  const msg = message.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel messages'].includes(msg);
}

function isHinglish(market) {
  return market === 'IN';
}

function programDurationWeeks(program) {
  const map = {
    '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
    'pcos': 6, '40plus': 6, 'zoom_trial': 1, 'zoom_pack': 4
  };
  return map[program] || 6;
}

function addWeeks(date, weeks) {
  const d = new Date(date);
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

module.exports = {
  maskPhone, detectMarket, normalizePhone, routeToProgram,
  needsEscalation, needsOptOut, isHinglish,
  programDurationWeeks, addWeeks
};
