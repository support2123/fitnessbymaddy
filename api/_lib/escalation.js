const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'chest pain', 'faint', 'hospital', 'doctor'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy({ reason, phone, clientName, message }) {
  const masked = phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
  const alert = [
    `ESCALATION ALERT`,
    `Reason: ${reason}`,
    `Client: ${clientName || 'Unknown'}`,
    `Phone: ${masked}`,
    `Message: "${(message || '').slice(0, 200)}"`,
    `Action needed — reply to this client directly.`
  ].join('\n');

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    body: alert
  });
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
