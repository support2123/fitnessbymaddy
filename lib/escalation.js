const { sendTemplate, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'purge', 'binge',
  'vomit', 'faint', 'chest pain', 'heart',
];

function needsEscalation(messageText) {
  if (!messageText) return false;
  const lower = messageText.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const msg = `ESCALATION: ${reason}\nClient: ${maskPhone(context.phone)}\nName: ${context.name || 'Unknown'}\nMessage: ${(context.message || '').slice(0, 200)}`;
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, maskPhone(context.phone), (context.message || '').slice(0, 100)]);
  console.log(`[ESCALATION] ${reason} for ${maskPhone(context.phone)}`);
  return msg;
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
