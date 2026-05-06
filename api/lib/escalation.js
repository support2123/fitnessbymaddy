const { notifyMaddy, maskPhone } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
  'surgery', 'heart', 'diabetes'
];

function needsEscalation(message) {
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalate(phone, reason, context) {
  await notifyMaddy(
    reason,
    `Phone: ${maskPhone(phone)}\nContext: ${context}`
  );
}

module.exports = { needsEscalation, escalate };
