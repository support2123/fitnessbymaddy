const { sendWhatsApp, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia',
  'bulimia', 'purging', 'faint', 'chest pain',
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy({ reason, phone, message, clientName }) {
  const masked = maskPhone(phone);
  const body = [
    '\u{1F6A8} ESCALATION',
    `Reason: ${reason}`,
    `Client: ${clientName || 'Lead'}`,
    `Phone: ${masked}`,
    `Message: "${(message || '').slice(0, 200)}"`,
  ].join('\n');

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    body,
    params: [reason, clientName || 'Unknown', masked],
  });
}

module.exports = { needsEscalation, escalateToMaddy };
