const { notifyMaddy, maskPhone } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex',
  'bulimi', 'not eating', 'vomit'
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalate(phone, reason, context) {
  const masked = maskPhone(phone);
  const msg = `ESCALATION: ${reason}\nLead: ${masked}\nContext: ${context}`;
  await notifyMaddy(msg);
}

module.exports = { needsEscalation, escalate, ESCALATION_KEYWORDS };
