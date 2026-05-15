const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'not working', 'scam', 'chest pain', 'heart', 'faint', 'vomit',
  'doctor', 'hospital', 'surgery', 'diabetes', 'thyroid'
];

function checkEscalation(message) {
  const lower = (message || '').toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter(k => lower.includes(k));
  return {
    shouldEscalate: matched.length > 0,
    keywords: matched
  };
}

function checkOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}

module.exports = { checkEscalation, checkOptOut, ESCALATION_KEYWORDS };
