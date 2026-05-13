const { sendWhatsAppForced } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'not eating',
  'medical condition', 'doctor said'
];

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy({ reason, phone, clientName, message }) {
  const masked = maskPhone(phone);
  const alertBody = [
    `ESCALATION ALERT`,
    `Reason: ${reason}`,
    `Client: ${clientName || 'Unknown'} (${masked})`,
    `Message: "${message ? message.slice(0, 200) : 'N/A'}"`,
    `Action needed - please review.`
  ].join('\n');

  return sendWhatsAppForced({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    body: alertBody,
    params: [reason, clientName || masked, message ? message.slice(0, 100) : 'N/A']
  });
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
