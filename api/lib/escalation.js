const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'condition', 'pregnant', 'pregnancy',
  'medication', 'medicine', 'pain', 'dizziness', 'dizzy', 'faint',
  'eating disorder', 'anorexia', 'bulimia', 'purging', 'not eating',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'side effects', 'chest pain', 'heart', 'surgery', 'hospital'
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel messages'];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(kw => lower.includes(kw));
}

function getEscalationReason(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  return matched.length > 0 ? matched.join(', ') : null;
}

module.exports = { needsEscalation, isOptOut, getEscalationReason };
