const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'condition', 'pregnancy', 'pregnant',
  'medication', 'medicine', 'pain', 'dizziness', 'dizzy', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'refund', 'lawyer', 'complaint',
  "didn't work", 'didnt work', 'side effect', 'side effects',
  'hospital', 'doctor', 'surgery', 'chest pain', 'faint', 'fainting',
  'vomit', 'vomiting', 'blood pressure'
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel messages'];

function checkEscalation(message) {
  const lower = message.toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  return matched.length > 0 ? matched : null;
}

function checkOptOut(message) {
  const lower = message.toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(kw => lower.includes(kw));
}

module.exports = { checkEscalation, checkOptOut };
