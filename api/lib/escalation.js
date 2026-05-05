const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia', 'bulimia',
  'vomit', 'faint', 'chest pain', 'heart'
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const msg = `ESCALATION: ${reason}\nPhone: ${context.phone || 'unknown'}\nDetails: ${context.details || 'N/A'}`;
  return sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, context.phone || '', context.details || '']);
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
