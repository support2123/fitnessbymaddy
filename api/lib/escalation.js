const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'bulimia', 'anorexia',
  'not eating', 'medical condition', 'surgery', 'doctor said'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, details) {
  const msg = `ESCALATION: ${reason}\n${details}`;
  return sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, details.substring(0, 200)]);
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
