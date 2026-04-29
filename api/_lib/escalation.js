const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'doctor', 'hospital',
  'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizziness', 'dizzy', 'faint',
  'eating disorder', 'anorexia', 'bulimia', 'purging',
  'refund', 'lawyer', 'complaint', 'legal',
  "didn't work", 'didnt work', 'not working',
  'side effect', 'side effects'
];

function checkEscalation(message) {
  const lower = (message || '').toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { escalate: true, reason: keyword };
    }
  }
  return { escalate: false, reason: null };
}

function checkOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}

module.exports = { checkEscalation, checkOptOut, ESCALATION_KEYWORDS };
