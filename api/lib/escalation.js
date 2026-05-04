const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'not eating', 'medical'
];

function needsEscalation(messageBody) {
  const lower = messageBody.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
    reason,
    context.phone || 'unknown',
    context.message || '',
  ]);
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
