const { sendText } = require('./whatsapp');
const { maskPhone } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex',
  'bulimi', 'not eating', 'vomit'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, phone, context) {
  const masked = maskPhone(phone);
  const msg = `ESCALATION ALERT\n\nReason: ${reason}\nLead/Client: ${masked}\nContext: ${context || 'N/A'}\n\nPlease review and respond manually.`;
  await sendText(MADDY_PHONE, msg);
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

module.exports = { needsEscalation, escalateToMaddy, isOptOut, ESCALATION_KEYWORDS };
