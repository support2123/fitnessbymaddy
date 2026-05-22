const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'purging', 'not eating',
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
    reason,
    context.phone || 'unknown',
    context.message || 'N/A',
  ]);
}

function isOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe';
}

module.exports = { needsEscalation, escalateToMaddy, isOptOut };
