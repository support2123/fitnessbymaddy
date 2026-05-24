const { notifyMaddy, maskPhone } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'anorexia', 'bulimia',
  'not eating', 'medical condition', 'surgery', 'heart', 'diabetes'
];

function needsEscalation(text) {
  const lower = (text || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

async function escalate(phone, reason, context) {
  const masked = maskPhone(phone);
  await notifyMaddy(
    `Escalation: ${reason}`,
    `Lead/Client: ${masked}\nReason: ${reason}\nContext: ${context}`
  );
}

module.exports = { needsEscalation, isOptOut, escalate };
