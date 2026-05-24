function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function detectProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  if (/fat\s*loss|weight|shred|burn/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone/.test(lower)) return 'pcos';
  if (/40|menopause|joints|joint/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship/.test(lower)) return '12wk';
  if (/trial|zoom|not\s*sure|try/.test(lower)) return 'zoom_trial';
  if (/home|no\s*gym|bodyweight/.test(lower)) return '6wk_home';
  return null;
}

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  const triggers = [
    'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
    'injury', 'pregnant', 'pregnancy', 'medication', 'medicine',
    'pain', 'dizzy', 'dizziness', 'eating disorder', 'vomit',
    'faint', 'chest pain', 'heart',
  ];
  return triggers.some(t => lower.includes(t));
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout'].includes(lower);
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

function programLabel(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Program',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Pack',
  };
  return map[code] || code;
}

function programPrice(code) {
  const map = {
    '6wk_gym': 97,
    '6wk_home': 97,
    '12wk': 200,
    'pcos': 45,
    '40plus': 50,
    'zoom_trial': 20,
    'zoom_pack': 80,
  };
  return map[code] || 0;
}

module.exports = {
  detectMarket,
  detectProgram,
  needsEscalation,
  isOptOut,
  maskPhone,
  programLabel,
  programPrice,
};
