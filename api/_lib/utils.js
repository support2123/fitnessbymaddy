export function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

export function detectProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  if (/fat\s*loss|weight|shred|lean|cut|burn/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|period|irregular/.test(lower)) return 'pcos';
  if (/40\+?|forty|menopause|joints|senior|mature/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|transform|dedicated/.test(lower)) return '12wk';
  if (/home|no\s*gym|bodyweight|at\s*home/.test(lower)) return '6wk_home';
  if (/trial|zoom|not\s*sure|try|unsure|explore/.test(lower)) return 'zoom_trial';
  return null;
}

export function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  const triggers = [
    'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
    'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
    'anorex', 'bulimi', 'purge', 'refund', 'lawyer', 'complaint',
    "didn't work", 'didnt work', 'side effect', 'doctor said',
    'surgery', 'heart', 'diabetes', 'blood pressure', 'thyroid'
  ];
  return triggers.some(t => lower.includes(t));
}

export function isOptOut(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel', 'remove me'].includes(lower);
}

export function normalizePhone(phone) {
  if (!phone) return '';
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.length === 10) cleaned = '+91' + cleaned;
    else cleaned = '+' + cleaned;
  }
  return cleaned;
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Session Pack'
};

export function programDisplayName(key) {
  return PROGRAM_NAMES[key] || key;
}

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build-gym',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom-flagship',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
};

export function getCheckoutLink(program) {
  return CHECKOUT_LINKS[program] || CHECKOUT_LINKS['zoom_trial'];
}

export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  };
}

export function jsonResponse(res, status, data) {
  res.status(status).json(data);
}
