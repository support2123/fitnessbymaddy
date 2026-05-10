const { sendWhatsAppToClient } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'anorexia', 'bulimia',
  'medical condition', 'surgery', 'heart', 'diabetes'
];

function needsEscalation(text) {
  const lower = (text || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy({ reason, phone, clientName, message }) {
  const masked = phone ? phone.slice(0, 3) + 'XXX...' + phone.slice(-3) : 'unknown';
  const alertBody = `ESCALATION ALERT\nReason: ${reason}\nClient: ${clientName || 'Unknown'}\nPhone: ${phone}\nMessage: ${(message || '').slice(0, 200)}`;

  await sendWhatsAppToClient(
    MADDY_PHONE,
    'escalation_alert',
    [reason, clientName || 'Lead', phone || masked],
    alertBody
  );
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
