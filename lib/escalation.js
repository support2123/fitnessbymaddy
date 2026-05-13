const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

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

async function escalateToMaddy(reason, context) {
  const msg = `ESCALATION: ${reason}\nPhone: ${maskPhone(context.phone)}\nDetails: ${context.details || 'N/A'}`;

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    maskPhone(context.phone),
    context.details || 'See dashboard'
  ]);

  console.log(`[ESCALATION] ${reason} — ${maskPhone(context.phone)}`);
  return { escalated: true, reason };
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
