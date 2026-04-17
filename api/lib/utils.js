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

  if (/fat\s*loss|weight|shred|lean|slim|burn/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone|period|irregular/.test(lower)) return 'pcos';
  if (/40\+?|forty|menopause|joints|senior|mature/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|advanced|flagship|transform/.test(lower)) return '12wk';
  if (/home|bodyweight|no\s*gym|no\s*equipment/.test(lower)) return '6wk_home';
  if (/trial|zoom|not\s*sure|try|test|unsure/.test(lower)) return 'zoom_trial';

  return null;
}

function isEscalationTrigger(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  const triggers = [
    'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
    'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex', 'bulimi',
    'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
    'vomit', 'faint', 'chest pain', 'heart', 'surgery',
  ];
  return triggers.some(t => lower.includes(t));
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'].includes(lower);
}

const PROGRAM_DETAILS = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 97, duration_weeks: 6 },
  '6wk_home': { name: '6-Week Burn & Build (Home)', price: 97, duration_weeks: 6 },
  '12wk': { name: '12-Week Custom Flagship', price: 200, duration_weeks: 12 },
  'pcos': { name: 'PCOS Warrior', price: 45, duration_weeks: 6 },
  '40plus': { name: '40+ Strong', price: 50, duration_weeks: 6 },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20, duration_weeks: 1 },
  'zoom_pack': { name: 'Zoom Sessions Pack', price: 120, duration_weeks: 4 },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

module.exports = {
  detectMarket,
  detectProgram,
  isEscalationTrigger,
  isOptOut,
  PROGRAM_DETAILS,
  jsonResponse,
  htmlResponse,
};
