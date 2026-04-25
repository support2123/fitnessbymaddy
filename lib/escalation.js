const { sendWhatsApp, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia',
  'bulimia', 'purging', 'not eating', 'heart', 'surgery',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const msg = `ESCALATION: ${reason}\nPhone: ${maskPhone(context.phone)}\nName: ${context.name || 'Unknown'}\nMessage: ${(context.message || '').slice(0, 200)}`;
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [reason, maskPhone(context.phone), (context.message || '').slice(0, 100)]);
  return msg;
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
