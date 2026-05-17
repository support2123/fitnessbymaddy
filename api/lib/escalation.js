const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'not eating',
  'throwing up', 'vomit'
];

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const msg = `ESCALATION: ${reason}\nPhone: ${context.phone}\nMessage: ${context.message || 'N/A'}`;
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, context.phone]);
  return msg;
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
