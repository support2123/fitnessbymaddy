const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorex', 'bulimi', 'purge', 'binge'
];

const MADDY_PHONE = '+917082478374';

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function getEscalationReason(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  const matched = ESCALATION_KEYWORDS.find(kw => lower.includes(kw));
  if (!matched) return null;

  if (['refund', 'lawyer', 'complaint', "didn't work", 'side effect'].includes(matched)) {
    return 'complaint_or_refund';
  }
  if (['injury', 'pregnant', 'pregnancy', 'medication', 'surgery'].includes(matched)) {
    return 'medical_condition';
  }
  return 'health_concern';
}

module.exports = { needsEscalation, getEscalationReason, MADDY_PHONE, ESCALATION_KEYWORDS };
