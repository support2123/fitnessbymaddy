const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex',
  'bulimi', 'faint', 'chest pain', 'heart', 'surgery'
];

function checkEscalation(message) {
  if (!message) return { escalate: false };
  const lower = message.toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  if (matched.length > 0) {
    return { escalate: true, keywords: matched };
  }
  return { escalate: false };
}

function checkOptOut(message) {
  if (!message) return false;
  const lower = message.toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

module.exports = { checkEscalation, checkOptOut };
