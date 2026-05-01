const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'not eating',
];

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function getEscalationReason(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  return matched.length > 0 ? matched.join(', ') : null;
}

async function notifyMaddy(context, phone, reason) {
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    context,
    phone.slice(-4),
    reason,
  ]);
}

module.exports = { needsEscalation, getEscalationReason, notifyMaddy };
