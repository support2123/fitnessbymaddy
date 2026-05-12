const { sendDirect } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'not eating', 'starving'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const msg = `ESCALATION: ${reason}\n\nClient: ${context.name || 'Unknown'}\nPhone: ${context.phone}\nMessage: ${context.message || 'N/A'}\n\nAction needed.`;
  return sendDirect(MADDY_PHONE, 'escalation_alert', {
    templateParams: [reason, context.phone, context.message || 'N/A']
  });
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
