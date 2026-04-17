const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'not eating', 'fainting', 'heart', 'surgery', 'doctor said',
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function detectProgram(message) {
  const lower = (message || '').toLowerCase();
  if (/fat\s*loss|weight|shred|slim|lose/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone|period|irregular/.test(lower)) return 'pcos';
  if (/40|menopause|joints|joint|senior|older/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|transform|flagship/.test(lower)) return '12wk';
  if (/home|bodyweight|no\s*gym|at\s*home/.test(lower)) return '6wk_home';
  if (/trial|zoom|not\s*sure|try|test/.test(lower)) return 'zoom_trial';
  return null;
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

async function notifyMaddy(reason, details) {
  const msg = `ESCALATION: ${reason}\n${details}`;
  try {
    await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [reason, details]);
  } catch {
    console.error('Failed to notify Maddy:', reason);
  }
}

const PROGRAM_PRICES = {
  '6wk_gym': 97,
  '6wk_home': 97,
  '12wk': 200,
  'pcos': 45,
  '40plus': 50,
  'zoom_trial': 20,
  'zoom_pack': 80,
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom 4-Pack',
};

module.exports = {
  needsEscalation,
  detectProgram,
  detectMarket,
  isOptOut,
  notifyMaddy,
  PROGRAM_PRICES,
  PROGRAM_NAMES,
  MADDY_PHONE,
};
