const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorex', 'bulimi',
  'not eating', 'vomit', 'faint'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  await sendTemplate(MADDY_PHONE, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [
      reason,
      context.phone || 'unknown',
      context.details || 'No details'
    ]
  });
}

function classifyProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/fat\s*loss|weight|shred|lean|cut/i.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone/i.test(lower)) return 'pcos';
  if (/40|forty|menopause|joint/i.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|transform/i.test(lower)) return '12wk';
  if (/trial|zoom|not sure|try|test/i.test(lower)) return 'zoom_trial';
  if (/home|bodyweight|no\s*gym|no\s*equipment/i.test(lower)) return '6wk_home';

  return null;
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Flagship Program',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Pack'
};

const PROGRAM_PRICES = {
  '6wk_gym': 97,
  '6wk_home': 97,
  '12wk': 200,
  'pcos': 45,
  '40plus': 50,
  'zoom_trial': 20,
  'zoom_pack': 80
};

module.exports = {
  needsEscalation,
  escalateToMaddy,
  classifyProgram,
  PROGRAM_NAMES,
  PROGRAM_PRICES,
  ESCALATION_KEYWORDS
};
