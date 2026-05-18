const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'not eating', 'blood pressure',
  'heart', 'diabetes', 'thyroid'
];

function needsEscalation(text) {
  if (!text) return { escalate: false, reason: null };
  const lower = text.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { escalate: true, reason: keyword };
    }
  }
  return { escalate: false, reason: null };
}

module.exports = { needsEscalation, ESCALATION_KEYWORDS };
