const { sendText } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex',
  'bulimi', 'purge', 'faint', 'heart'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, phone, messageText) {
  const masked = maskPhone(phone);
  const alert = `🚨 ESCALATION\nReason: ${reason}\nLead: ${masked}\nMessage: "${(messageText || '').slice(0, 200)}"`;
  await sendText(MADDY_PHONE, alert);
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
