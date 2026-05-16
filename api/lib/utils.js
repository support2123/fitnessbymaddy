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

function classifyIntent(message) {
  const msg = (message || '').toLowerCase();

  if (/fat\s*loss|weight|shred|lean|cut/.test(msg)) {
    return { program: '6wk_gym', name: '6-Week Burn & Build' };
  }
  if (/pcos|hormonal|period|irregular/.test(msg)) {
    return { program: 'pcos', name: 'PCOS Warrior' };
  }
  if (/40|menopause|joints|senior|mature/.test(msg)) {
    return { program: '40plus', name: '40+ Strong' };
  }
  if (/custom|12\s*week|serious|flagship|transform/.test(msg)) {
    return { program: '12wk', name: '12-Week Flagship' };
  }
  if (/trial|zoom|not sure|try|test/.test(msg)) {
    return { program: 'zoom_trial', name: 'Zoom Trial' };
  }
  if (/home|no\s*gym|bodyweight|at\s*home/.test(msg)) {
    return { program: '6wk_home', name: '6-Week Home Program' };
  }
  return null;
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'not eating', 'purging'
];

function needsEscalation(message) {
  const msg = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => msg.includes(kw));
}

function isOptOut(message) {
  const msg = (message || '').toLowerCase().trim();
  return msg === 'stop' || msg === 'unsubscribe' || msg === 'opt out' || msg === 'optout';
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

module.exports = { detectMarket, maskPhone, classifyIntent, needsEscalation, isOptOut, jsonResponse };
