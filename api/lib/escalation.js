const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'binge', 'purge',
  'not eating', 'faint', 'hospital'
];

function needsEscalation(message) {
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    context.phone || 'unknown',
    context.message || '',
    new Date().toISOString()
  ]);
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
