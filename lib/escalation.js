const { notifyMaddy } = require('./whatsapp');
const { maskPhone } = require('./market');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'purge', 'binge',
  'not eating', 'starving', 'heart', 'surgery', 'doctor said',
  'hospital', 'medical'
];

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

async function escalateIfNeeded(phone, message, context) {
  if (!needsEscalation(message)) return false;

  const matched = ESCALATION_KEYWORDS.filter(kw =>
    message.toLowerCase().includes(kw)
  );

  await notifyMaddy(
    `Lead/Client needs attention`,
    `Phone: ${maskPhone(phone)}\nTrigger: ${matched.join(', ')}\nContext: ${context || 'WhatsApp message'}\nMessage: "${message.slice(0, 300)}"`
  );

  return true;
}

module.exports = { needsEscalation, isOptOut, escalateIfNeeded, ESCALATION_KEYWORDS };
