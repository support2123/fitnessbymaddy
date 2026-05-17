const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'not eating', 'starving', 'vomit'
];

function shouldEscalate(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
    reason,
    context.phone || 'unknown',
    context.message || '',
  ]);
}

function isOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

module.exports = { shouldEscalate, escalateToMaddy, isOptOut, ESCALATION_KEYWORDS };
