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

function detectProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/fat\s*loss|weight|shred|lean/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone/.test(lower)) return 'pcos';
  if (/40\+?|forty|menopause|joint/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship/.test(lower)) return '12wk';
  if (/home|no\s*gym|bodyweight/.test(lower)) return '6wk_home';
  if (/trial|zoom|not\s*sure|try/.test(lower)) return 'zoom_trial';
  return null;
}

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const triggers = [
    'injury', 'medical', 'pregnan', 'medication', 'medicine',
    'pain', 'dizzi', 'disordered', 'eating disorder', 'anorex', 'bulimi',
    'refund', 'lawyer', 'complaint', "didn't work", 'did not work',
    'side effect', 'vomit', 'faint', 'hospital', 'doctor',
    'chest pain', 'heart', 'surgery'
  ];
  return triggers.some(t => lower.includes(t));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'].includes(lower);
}

function programLabel(code) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Pack'
  };
  return labels[code] || code;
}

function programPrice(code) {
  const prices = {
    '6wk_gym': 97,
    '6wk_home': 97,
    '12wk': 200,
    'pcos': 45,
    '40plus': 50,
    'zoom_trial': 20,
    'zoom_pack': 80
  };
  return prices[code] || 0;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

module.exports = {
  maskPhone,
  detectMarket,
  detectProgram,
  needsEscalation,
  isOptOut,
  programLabel,
  programPrice,
  jsonResponse
};
