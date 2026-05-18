const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'not eating', 'starving', 'purging', 'vomit',
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const body = `ESCALATION ALERT\n\nReason: ${reason}\n\nContext: ${context}\n\nPlease review and take action.`;
  await sendWhatsApp(MADDY_PHONE, body);
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
