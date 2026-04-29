const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'surgery', 'heart', 'diabetes', 'thyroid',
];

const OPTOUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout'];

function needsEscalation(text) {
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  const lower = text.trim().toLowerCase();
  return OPTOUT_KEYWORDS.some(kw => lower === kw || lower.includes(kw));
}

function getEscalationReason(text) {
  const lower = text.toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  return matched.join(', ');
}

module.exports = { needsEscalation, isOptOut, getEscalationReason };
