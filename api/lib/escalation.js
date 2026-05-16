const { notifyMaddy } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'anorex', 'bulimi', 'purge', 'not eating'
];

function checkEscalation(message) {
  const lower = (message || '').toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { escalate: true, trigger: keyword };
    }
  }
  return { escalate: false };
}

function classifyIntent(message) {
  const lower = (message || '').toLowerCase();

  if (/fat\s*loss|weight|shred|lean|cut/i.test(lower)) {
    return { program: '6wk_gym', name: '6-Week Burn & Build', price: 97 };
  }
  if (/pcos|hormonal|period|irregular/i.test(lower)) {
    return { program: 'pcos', name: 'PCOS Warrior', price: 45 };
  }
  if (/40|menopause|joints|senior|age/i.test(lower)) {
    return { program: '40plus', name: '40+ Strong', price: 50 };
  }
  if (/custom|12\s*week|serious|transform|flagship/i.test(lower)) {
    return { program: '12wk', name: '12-Week Flagship', price: 200 };
  }
  if (/trial|zoom|not sure|try|test/i.test(lower)) {
    return { program: 'zoom_trial', name: 'Zoom Trial Session', price: 20 };
  }
  if (/home|no\s*gym|bodyweight|at home/i.test(lower)) {
    return { program: '6wk_home', name: '6-Week Home Burn', price: 79 };
  }
  return null;
}

async function handleEscalation(phone, message, trigger) {
  const masked = phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
  await notifyMaddy(
    `Escalation: "${trigger}"`,
    `From ${masked}: "${message.slice(0, 100)}"`
  );
}

module.exports = { checkEscalation, classifyIntent, handleEscalation };
