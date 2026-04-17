const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'not eating'
];

const OPTOUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'remove me'];

function checkEscalation(message) {
  const lower = message.toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  return matched.length > 0 ? matched : null;
}

function checkOptOut(message) {
  const lower = message.toLowerCase().trim();
  return OPTOUT_KEYWORDS.some(kw => lower.includes(kw));
}

module.exports = { checkEscalation, checkOptOut, ESCALATION_KEYWORDS };
