const { notifyMaddy, maskPhone } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'not eating',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateMessage(phone, text, reason) {
  const masked = maskPhone(phone);
  await notifyMaddy(
    reason || 'Message flagged for review',
    `From: ${masked}\nMessage: "${text.slice(0, 200)}"`
  );
}

async function escalateMissedCheckins(clientName, phone, missedCount) {
  const masked = maskPhone(phone);
  await notifyMaddy(
    `${missedCount} consecutive missed check-ins`,
    `Client: ${clientName}\nPhone: ${masked}\nMissed: ${missedCount} weeks`
  );
}

async function escalatePaymentFailure(clientName, phone, program) {
  const masked = maskPhone(phone);
  await notifyMaddy(
    'Payment failure for active client',
    `Client: ${clientName}\nPhone: ${masked}\nProgram: ${program}`
  );
}

module.exports = {
  needsEscalation,
  escalateMessage,
  escalateMissedCheckins,
  escalatePaymentFailure,
};
