const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'not eating', 'faint', 'hospital'
];

function needsEscalation(messageText) {
  if (!messageText) return { escalate: false };
  const lower = messageText.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) {
      return { escalate: true, trigger: kw };
    }
  }
  return { escalate: false };
}

async function escalateToMaddy({ reason, phone, clientName, messageText }) {
  const masked = maskPhone(phone);
  const body = `ESCALATION ALERT\n\nReason: ${reason}\nClient: ${clientName || 'Unknown'}\nPhone: ${masked}\nMessage: "${messageText?.substring(0, 200) || 'N/A'}"\n\nPlease review and respond directly.`;

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    body,
    params: {
      name: 'Maddy',
      templateParams: [reason, clientName || 'Unknown', masked]
    }
  });
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
