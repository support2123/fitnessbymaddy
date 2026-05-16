const { notifyMaddy, maskPhone } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'not eating'
];

function needsEscalation(text) {
  const lower = (text || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalate(phone, reason, messageBody) {
  const masked = maskPhone(phone);
  await notifyMaddy(
    `ESCALATION: ${reason}`,
    `Lead ${masked} said: "${(messageBody || '').slice(0, 120)}"`
  );
}

module.exports = { needsEscalation, escalate, ESCALATION_KEYWORDS };
