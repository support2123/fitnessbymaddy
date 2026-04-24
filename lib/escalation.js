const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'doctor', 'surgery', 'pregnant', 'pregnancy',
  'medication', 'medicine', 'pain', 'dizziness', 'dizzy', 'faint',
  'eating disorder', 'anorexia', 'bulimia', 'purge', 'binge',
  'refund', 'lawyer', 'complaint', 'legal',
  "didn't work", 'not working', 'side effect', 'side effects',
  'heart', 'blood pressure', 'diabetes', 'thyroid'
];

function needsEscalation(text) {
  if (!text) return { escalate: false, reasons: [] };
  const lower = text.toLowerCase();
  const reasons = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  return { escalate: reasons.length > 0, reasons };
}

module.exports = { needsEscalation, ESCALATION_KEYWORDS };
