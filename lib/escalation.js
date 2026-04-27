const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'anorexia', 'bulimia',
  'vomit', 'faint', 'heart', 'surgery', 'hospital',
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, phone, context) {
  const masked = maskPhone(phone);
  const body = `ESCALATION: ${reason}\nLead/Client: ${masked}\nContext: ${context}`;
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [reason, masked, context]);
  console.log(`[ESCALATION] ${reason} for ${masked}`);
  return body;
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
