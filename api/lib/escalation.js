const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'not eating',
  'medical', 'doctor', 'hospital'
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, leadPhone, context) {
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    leadPhone.slice(-4),
    context.slice(0, 100)
  ]);
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
