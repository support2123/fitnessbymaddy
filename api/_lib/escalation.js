const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'anorex', 'bulimi', 'purge', 'not eating',
];

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOutMessage(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function escalateToMaddy(reason, details) {
  const msg = `ESCALATION: ${reason}\n\n${details}`;
  return sendWhatsApp(MADDY_PHONE, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [reason, details.slice(0, 500)],
  });
}

module.exports = { needsEscalation, isOptOutMessage, escalateToMaddy, MADDY_PHONE };
