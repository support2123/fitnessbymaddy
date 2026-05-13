const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'vomit', 'faint', 'chest pain', 'heart', 'surgery'
];

function needsEscalation(messageBody) {
  const lower = (messageBody || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function getEscalationReason(messageBody) {
  const lower = (messageBody || '').toLowerCase();
  return ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

module.exports = { needsEscalation, getEscalationReason, maskPhone };
