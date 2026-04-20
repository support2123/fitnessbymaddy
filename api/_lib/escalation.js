const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex',
  'bulimi', 'not eating', 'faint', 'chest pain',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const msg = `ESCALATION: ${reason}\nPhone: ${maskPhone(context.phone)}\nMessage: ${(context.body || '').slice(0, 200)}`;
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, maskPhone(context.phone)]);
  console.log(msg);
  return { escalated: true, reason };
}

module.exports = { needsEscalation, escalateToMaddy, MADDY_PHONE };
