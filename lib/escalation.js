const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'vomit', 'faint', 'chest pain', 'heart'
];

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy({ reason, phone, message, clientName }) {
  const masked = phone ? phone.slice(0, 5) + '...' + phone.slice(-3) : 'unknown';
  const body = `ESCALATION ALERT\n\nReason: ${reason}\nClient: ${clientName || 'Unknown'}\nPhone: ${masked}\nMessage: "${(message || '').slice(0, 200)}"\n\nPlease review and respond directly.`;

  await sendWhatsApp({
    phone: MADDY_PHONE,
    body,
    templateName: null
  });
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
