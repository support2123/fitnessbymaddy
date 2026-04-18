const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'injured', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia', 'bulimia',
  'vomiting', 'faint', 'chest pain', 'heart'
];

function needsEscalation(message) {
  if (!message) return { escalate: false };
  const lower = message.toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  if (matched.length === 0) return { escalate: false };
  return { escalate: true, keywords: matched };
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

module.exports = { needsEscalation, isOptOut, ESCALATION_KEYWORDS };
