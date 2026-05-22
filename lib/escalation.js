const { sendTextMessage } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'medical', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'not eating', 'faint', 'hospital'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, details) {
  const msg = `🚨 ESCALATION NEEDED\n\nReason: ${reason}\n\nDetails:\n${details}\n\nPlease review and respond manually.`;

  console.log(`Escalation triggered: ${reason}`);
  await sendTextMessage(MADDY_PHONE, msg);
}

function checkOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

module.exports = { needsEscalation, escalateToMaddy, checkOptOut };
