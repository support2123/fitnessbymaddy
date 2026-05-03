const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'binge'
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

async function escalateToMaddy(reason, context) {
  const msg = `[ESCALATION] ${reason}\nClient: ${context.phone || 'unknown'}\nDetails: ${context.details || 'N/A'}`;
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, context.phone || '', context.details || '']);
  return msg;
}

module.exports = { needsEscalation, isOptOut, escalateToMaddy, MADDY_PHONE };
