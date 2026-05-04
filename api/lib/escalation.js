const { notifyMaddy } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'vomit', 'faint', 'heart'
];

function needsEscalation(text) {
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalate(phone, reason) {
  const masked = phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
  await notifyMaddy(`ESCALATION: ${reason} | Lead: ${masked}`);
}

module.exports = { needsEscalation, escalate };
