const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./phone');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'anorexia', 'bulimia',
  'vomit', 'faint', 'chest pain', 'heart',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy({ reason, phone, context }) {
  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    params: [reason, maskPhone(phone), context || 'No additional context'],
    body: `🚨 ESCALATION: ${reason}\nLead: ${maskPhone(phone)}\nContext: ${context || 'N/A'}`,
  });
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
