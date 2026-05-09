const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'vomit', 'chest pain', 'heart',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, phone, context) {
  const masked = maskPhone(phone);
  const msg = `ESCALATION: ${reason}\nLead: ${masked}\nContext: ${context}`;
  console.warn(`[ESCALATION] ${msg}`);
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, masked, context.slice(0, 100)]);
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
