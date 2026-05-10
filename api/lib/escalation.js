const { sendText } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia',
  'bulimia', 'vomit', 'heart', 'chest pain', 'faint',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

async function escalateToMaddy(reason, phone, context) {
  const masked = maskPhone(phone);
  const msg =
    `ESCALATION ALERT\n` +
    `Reason: ${reason}\n` +
    `Lead/Client: ${masked}\n` +
    `Context: ${context || 'N/A'}\n` +
    `Action needed — check admin dashboard.`;

  await sendText(MADDY_PHONE, msg);
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
