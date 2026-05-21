const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'doctor', 'hospital',
  'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizzy', 'dizziness', 'faint', 'chest pain',
  'eating disorder', 'anorexia', 'bulimia', 'binge',
  'refund', 'lawyer', 'complaint', 'legal',
  "didn't work", 'didnt work', 'not working',
  'side effect', 'side effects'
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
