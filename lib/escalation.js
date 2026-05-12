const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'doctor', 'hospital',
  'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizziness', 'dizzy', 'faint',
  'eating disorder', 'anorexia', 'bulimia', 'purging', 'binge',
  'refund', 'lawyer', 'complaint', 'legal',
  "didn't work", 'didnt work', 'not working',
  'side effect', 'side effects'
];

function needsEscalation(text) {
  if (!text) return { escalate: false };
  const lower = text.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { escalate: true, trigger: keyword };
    }
  }
  return { escalate: false };
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}

module.exports = { needsEscalation, isOptOut, ESCALATION_KEYWORDS };
