const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'not eating'
];

function needsEscalation(text) {
  const lower = (text || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function escalateToMaddy(reason, details) {
  const msg = `🚨 ESCALATION\n\nReason: ${reason}\n\n${details}\n\nPlease review and respond.`;
  await sendWhatsApp(MADDY_PHONE, [reason, details], 'escalation_alert');
  return true;
}

module.exports = { needsEscalation, isOptOut, escalateToMaddy, MADDY_PHONE };
