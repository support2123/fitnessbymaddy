const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'doctor', 'hospital',
  'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizziness', 'dizzy', 'faint', 'vomit',
  'eating disorder', 'anorexia', 'bulimia', 'binge',
  'refund', 'lawyer', 'complaint', 'legal',
  "didn't work", 'not working', 'side effect', 'side effects',
  'chest pain', 'heart', 'surgery'
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function getEscalationReason(message) {
  const lower = (message || '').toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  return matched.join(', ');
}

module.exports = { needsEscalation, getEscalationReason, ESCALATION_KEYWORDS };
