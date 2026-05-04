const { sendTemplate, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex',
  'bulimi', 'purge', 'faint'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const maskedPhone = context.phone ? maskPhone(context.phone) : 'unknown';
  const msg = `ESCALATION: ${reason}\nClient: ${context.name || maskedPhone}\nPhone: ${maskedPhone}\nDetails: ${context.details || 'N/A'}`;

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    context.name || 'Unknown',
    context.details || 'Check admin dashboard'
  ]);

  return msg;
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
