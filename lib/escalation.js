const { sendText } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorex', 'bulimi', 'purge', 'not eating'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, phone, context) {
  const masked = maskPhone(phone);
  const msg = `ESCALATION ALERT\n\nReason: ${reason}\nLead/Client: ${masked}\nContext: ${context?.slice(0, 500) || 'N/A'}\n\nPlease review and respond manually.`;
  await sendText(MADDY_PHONE, msg);
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
