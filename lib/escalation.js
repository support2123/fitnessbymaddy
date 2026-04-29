const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'purging', 'not eating'
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
  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    params: [reason, context.phone || 'unknown', context.message || 'N/A']
  });
}

module.exports = { needsEscalation, isOptOut, escalateToMaddy, MADDY_PHONE };
