const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex',
  'bulimi', 'not eating', 'fainting', 'faint'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function escalateToMaddy(reason, phone, context) {
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    phone.slice(-4),
    context || 'No additional context'
  ]);
}

function detectProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/fat\s*loss|weight|shred|lean|slim/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone|period|irregular/.test(lower)) return 'pcos';
  if (/40|menopause|joints|senior|knee/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|advance|flagship/.test(lower)) return '12wk';
  if (/trial|zoom|not sure|try|test/.test(lower)) return 'zoom_trial';
  if (/home|no gym|bodyweight|at home/.test(lower)) return '6wk_home';

  return null;
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Pack'
};

module.exports = {
  needsEscalation,
  isOptOut,
  escalateToMaddy,
  detectProgram,
  PROGRAM_NAMES,
  MADDY_PHONE
};
