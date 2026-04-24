const { sendText } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'not eating', 'vomiting', 'faint', 'hospital'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, details) {
  const msg = `ESCALATION ALERT\n\nReason: ${reason}\n\nDetails:\n${details}\n\nPlease review and respond manually.`;
  await sendText(MADDY_PHONE, msg, true);
}

async function checkAndEscalate(phone, text) {
  if (!needsEscalation(text)) return false;

  await escalateToMaddy(
    'Flagged keyword in client message',
    `From: ${maskPhone(phone)}\nMessage: ${text.slice(0, 300)}`
  );
  return true;
}

module.exports = { needsEscalation, escalateToMaddy, checkAndEscalate, MADDY_PHONE };
