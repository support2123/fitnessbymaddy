const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'not eating', 'vomiting'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const msg = `ESCALATION ALERT\n\nReason: ${reason}\n\nClient: ${context.name || 'Unknown'}\nPhone: ${context.phone}\n\nMessage: ${context.message || 'N/A'}\n\nAction needed: Please review and respond directly.`;

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [reason, context.phone, context.message || 'N/A']
  });

  return { escalated: true, reason };
}

function detectOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'].includes(lower);
}

module.exports = { needsEscalation, escalateToMaddy, detectOptOut, ESCALATION_KEYWORDS };
