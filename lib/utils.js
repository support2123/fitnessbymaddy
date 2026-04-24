function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

function classifyIntent(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  if (/\b(fat\s*loss|weight|shred|lose|slim|lean)\b/.test(lower)) return '6wk_gym';
  if (/\b(pcos|hormonal|pcod|period|irregular)\b/.test(lower)) return 'pcos';
  if (/\b(40|forty|menopause|joints|senior|age)\b/.test(lower)) return '40plus';
  if (/\b(custom|12\s*week|serious|flagship|transform)\b/.test(lower)) return '12wk';
  if (/\b(trial|zoom|not sure|try|test|sample)\b/.test(lower)) return 'zoom_trial';
  if (/\b(home|no\s*gym|bodyweight|at\s*home)\b/.test(lower)) return '6wk_home';
  return null;
}

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  const triggers = [
    'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
    'pain', 'dizzy', 'dizziness', 'disordered', 'eating disorder',
    'anorex', 'bulimi', 'refund', 'lawyer', 'complaint',
    "didn't work", 'didnt work', 'side effect', 'surgery',
    'heart', 'diabetes', 'blood pressure', 'thyroid'
  ];
  return triggers.some(t => lower.includes(t));
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

function getProgramDetails(programKey) {
  const programs = {
    '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 97, weeks: 6, checkoutSlug: '6wk-gym' },
    '6wk_home': { name: '6-Week Burn & Build (Home)', price: 97, weeks: 6, checkoutSlug: '6wk-home' },
    '12wk': { name: '12-Week Custom Flagship', price: 200, weeks: 12, checkoutSlug: '12wk-custom' },
    'pcos': { name: 'PCOS Warrior Program', price: 45, weeks: 8, checkoutSlug: 'pcos-warrior' },
    '40plus': { name: '40+ Strong Program', price: 50, weeks: 8, checkoutSlug: '40plus-strong' },
    'zoom_trial': { name: 'Zoom Trial Session', price: 20, weeks: 1, checkoutSlug: 'zoom-trial' },
    'zoom_pack': { name: 'Zoom Session Pack', price: 150, weeks: 4, checkoutSlug: 'zoom-pack' },
  };
  return programs[programKey] || null;
}

function getProgramEndDate(startDate, weeks) {
  const end = new Date(startDate);
  end.setDate(end.getDate() + weeks * 7);
  return end;
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

module.exports = {
  detectMarket,
  maskPhone,
  classifyIntent,
  needsEscalation,
  isOptOut,
  getProgramDetails,
  getProgramEndDate,
  jsonResponse,
  corsHeaders,
};
