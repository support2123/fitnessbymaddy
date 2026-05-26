const { sendTemplate, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia',
  'bulimia', 'vomit', 'faint', 'chest pain', 'heart'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const msg = `ESCALATION: ${reason}\nPhone: ${maskPhone(context.phone)}\nDetails: ${context.details || 'N/A'}`;
  console.log(msg);

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    maskPhone(context.phone),
    context.details || 'Review needed'
  ]);

  return { escalated: true, reason };
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
