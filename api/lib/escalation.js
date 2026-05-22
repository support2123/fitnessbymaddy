const { notifyMaddy, maskPhone } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'vomit',
  'eating disorder', 'anorex', 'bulimi', 'purge', 'binge'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalate(reason, phone, context) {
  const details = [
    `Phone: ${maskPhone(phone)}`,
    `Reason: ${reason}`,
    `Context: ${context}`
  ].join('\n');

  return notifyMaddy(reason, details);
}

module.exports = { needsEscalation, escalate, ESCALATION_KEYWORDS };
