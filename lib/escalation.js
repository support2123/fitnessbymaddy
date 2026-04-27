const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'heart', 'surgery', 'hospital', 'doctor said'
];

function needsEscalation(text) {
  if (!text) return { escalate: false, reason: null };
  const lower = text.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) {
      return { escalate: true, reason: kw };
    }
  }
  return { escalate: false, reason: null };
}

module.exports = { needsEscalation, ESCALATION_KEYWORDS };
