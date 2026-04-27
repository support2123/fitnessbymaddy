const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'vomit', 'faint', 'chest pain', 'heart'
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const body = `ESCALATION ALERT\n\nReason: ${reason}\n\nContext:\n${JSON.stringify(context, null, 2)}`;
  await sendWhatsApp(MADDY_PHONE, body, null);
}

function isOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe';
}

module.exports = { needsEscalation, escalateToMaddy, isOptOut };
