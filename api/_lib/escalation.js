const { sendEscalation } = require('./whatsapp');
const { maskPhone } = require('./market');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'not eating',
  'throwing up', 'vomit',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateIfNeeded(phone, text, context = '') {
  if (!needsEscalation(text)) return false;

  const masked = maskPhone(phone);
  const msg = `ESCALATION: ${context} from ${masked}: "${text.slice(0, 200)}"`;
  await sendEscalation(msg);
  return true;
}

function detectOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

module.exports = { needsEscalation, escalateIfNeeded, detectOptOut };
