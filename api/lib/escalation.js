const { sendTemplateForced } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'purging', 'starving',
  'medical condition', 'surgery', 'heart', 'diabetes'
];

function needsEscalation(messageText) {
  if (!messageText) return false;
  const lower = messageText.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(messageText) {
  if (!messageText) return false;
  const lower = messageText.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function notifyMaddy(reason, details) {
  await sendTemplateForced(MADDY_PHONE, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [reason, details]
  });
}

module.exports = { needsEscalation, isOptOut, notifyMaddy, ESCALATION_KEYWORDS };
