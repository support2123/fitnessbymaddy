const { sendWhatsApp, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'not eating', 'vomiting', 'faint', 'chest pain', 'heart'
];

function needsEscalation(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, clientName, clientPhone) {
  await sendWhatsApp(MADDY_PHONE, 'escalation_maddy', {
    reason,
    name: clientName || 'Unknown',
    phone: maskPhone(clientPhone),
    _isClient: true
  });
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
