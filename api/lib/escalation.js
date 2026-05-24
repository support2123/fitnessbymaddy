const { notifyMaddy } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'not eating'
];

function needsEscalation(messageText) {
  const lower = messageText.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function detectProgramInterest(messageText) {
  const lower = messageText.toLowerCase();

  if (/fat\s*loss|weight|shred|lean|cut/.test(lower)) {
    return { program: '6wk_gym', name: '6-Week Burn & Build' };
  }
  if (/pcos|hormonal|hormone|period|irregular/.test(lower)) {
    return { program: 'pcos', name: 'PCOS Warrior' };
  }
  if (/40|menopause|joints|joint|senior|older/.test(lower)) {
    return { program: '40plus', name: '40+ Strong' };
  }
  if (/custom|12\s*week|serious|full|flagship|transform/.test(lower)) {
    return { program: '12wk', name: '12-Week Custom Program' };
  }
  if (/trial|zoom|not sure|try|test|unsure/.test(lower)) {
    return { program: 'zoom_trial', name: '$20 Zoom Trial' };
  }
  if (/home|no\s*gym|bodyweight|at\s*home/.test(lower)) {
    return { program: '6wk_home', name: '6-Week Home Workout' };
  }

  return null;
}

async function escalate(phone, reason) {
  await notifyMaddy(`Phone: ${phone.slice(0, 5)}***${phone.slice(-3)} | Reason: ${reason}`);
}

module.exports = { needsEscalation, detectProgramInterest, escalate };
