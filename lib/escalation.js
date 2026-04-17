const { sendText } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'vomit',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const msg =
    `🚨 ESCALATION NEEDED\n\n` +
    `Reason: ${reason}\n` +
    `Phone: ${context.phone || 'N/A'}\n` +
    `Name: ${context.name || 'Unknown'}\n` +
    `Message: ${(context.message || '').slice(0, 200)}\n\n` +
    `Please review and respond directly.`;

  await sendText(MADDY_PHONE, msg);
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
