const { notifyMaddy, maskPhone } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'chest pain',
  'eating disorder', 'anorex', 'bulim', 'purging', 'not eating',
  'heart', 'doctor said', 'hospital'
];

function needsEscalation(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalate(phone, reason, context) {
  await notifyMaddy(
    reason,
    `Phone: ${maskPhone(phone)}\nContext: ${context}`
  );
}

module.exports = { needsEscalation, escalate, ESCALATION_KEYWORDS };
