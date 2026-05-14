const { sendWhatsAppUnlimited } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'faint', 'chest pain', 'heart', 'surgery'
];

function needsEscalation(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function escalateToMaddy({ reason, phone, clientName, details }) {
  const masked = maskPhone(phone);
  const body = `ESCALATION\nReason: ${reason}\nClient: ${clientName || 'Unknown'} (${masked})\nDetails: ${details || 'N/A'}`;

  await sendWhatsAppUnlimited({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    params: [reason, clientName || 'Unknown', masked, details || 'Review needed']
  });

  return { escalated: true };
}

module.exports = { needsEscalation, isOptOut, escalateToMaddy, MADDY_PHONE };
