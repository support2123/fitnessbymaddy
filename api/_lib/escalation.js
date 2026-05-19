const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'surgery', 'doctor', 'hospital'
];

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function needsOptOut(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

module.exports = { needsEscalation, needsOptOut, ESCALATION_KEYWORDS };
