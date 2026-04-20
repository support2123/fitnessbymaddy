const { notifyMaddy } = require('./whatsapp');
const { maskPhone } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'not eating',
];

function needsEscalation(text) {
  const lower = (text || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalate(phone, reason, context) {
  const masked = maskPhone(phone);
  await notifyMaddy(
    reason,
    `Lead/Client: ${masked}\nContext: ${context}`
  );
}

module.exports = { needsEscalation, escalate, ESCALATION_KEYWORDS };
