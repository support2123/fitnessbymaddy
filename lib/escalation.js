const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'condition', 'pregnancy', 'pregnant',
  'medication', 'medicine', 'pain', 'dizziness', 'dizzy', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'refund', 'lawyer', 'complaint',
  "didn't work", 'did not work', 'side effect', 'side effects',
  'hospital', 'doctor', 'surgery', 'heart', 'diabetes', 'thyroid'
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel messages'];

function needsEscalation(text) {
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  const lower = text.toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(kw => lower.includes(kw));
}

function getEscalationReason(text) {
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
}

module.exports = { needsEscalation, isOptOut, getEscalationReason };
