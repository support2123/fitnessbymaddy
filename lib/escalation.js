const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'refund', 'lawyer', 'complaint', "didn't work", 'did not work',
  'side effect', 'side effects', 'surgery', 'doctor', 'hospital',
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout'];

function checkEscalation(text) {
  const lower = text.toLowerCase();
  const triggers = ESCALATION_KEYWORDS.filter(k => lower.includes(k));
  return triggers.length > 0 ? triggers : null;
}

function isOptOut(text) {
  const lower = text.toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(k => lower.includes(k));
}

module.exports = { checkEscalation, isOptOut };
