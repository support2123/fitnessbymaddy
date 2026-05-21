const { sendMessage } = require('./whatsapp');
const { maskPhone } = require('./mask-phone');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'not eating',
  'throwing up', 'surgery', 'medical',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function escalateToMaddy(reason, context) {
  const msg = `ESCALATION: ${reason}\n${context}`;
  console.log(`Escalating to Maddy: ${reason}`);
  await sendMessage(MADDY_PHONE, msg, 'escalation_alert', true);
}

module.exports = { needsEscalation, isOptOut, escalateToMaddy, ESCALATION_KEYWORDS };
