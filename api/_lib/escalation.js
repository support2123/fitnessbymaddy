const { notifyMaddy, maskPhone } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'didnt work',
  'side effect', 'side effects', 'doctor', 'hospital'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalate(reason, phone, context) {
  const masked = maskPhone(phone);
  const msg = `🚨 ESCALATION NEEDED\nReason: ${reason}\nLead: ${masked}\nContext: ${context || 'N/A'}\n\nPlease review in the admin dashboard.`;
  await notifyMaddy(msg);
}

function needsOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}

module.exports = { needsEscalation, escalate, needsOptOut };
