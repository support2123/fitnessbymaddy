const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'vomit',
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, phone, context) {
  const masked = maskPhone(phone);
  const text = `ESCALATION: ${reason}\nLead/Client: ${masked}\nContext: ${context}`;
  console.log(`[ESCALATION] ${text}`);

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, masked, context], true);

  return { escalated: true, reason };
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
