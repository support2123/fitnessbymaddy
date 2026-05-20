const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'chest pain', 'fainted', 'vomit', 'blood pressure',
];

const STOP_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout'];

function checkEscalation(text) {
  const lower = text.toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  return matched.length > 0 ? matched : null;
}

function checkOptOut(text) {
  const lower = text.toLowerCase().trim();
  return STOP_KEYWORDS.some(kw => lower === kw || lower.startsWith(kw));
}

module.exports = { checkEscalation, checkOptOut };
