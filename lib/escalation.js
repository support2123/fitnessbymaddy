const { sendText } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'not eating', 'vomiting', 'faint', 'chest pain', 'surgery',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

async function escalateToMaddy(reason, details) {
  const msg =
    `🚨 ESCALATION ALERT\n\n` +
    `Reason: ${reason}\n` +
    `Details: ${details}\n\n` +
    `Please review in the admin dashboard.`;
  await sendText(MADDY_PHONE, msg, true);
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
