const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'condition', 'pregnancy', 'pregnant',
  'medication', 'medicine', 'pain', 'dizziness', 'dizzy', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'refund', 'lawyer', 'complaint',
  "didn't work", 'did not work', 'side effect', 'side effects'
];

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function classifyEscalation(message) {
  const lower = (message || '').toLowerCase();
  if (['injury', 'injured', 'pain', 'dizziness', 'dizzy'].some(k => lower.includes(k)))
    return 'health_concern';
  if (['pregnancy', 'pregnant'].some(k => lower.includes(k)))
    return 'pregnancy';
  if (['medication', 'medicine', 'medical', 'condition'].some(k => lower.includes(k)))
    return 'medical';
  if (['eating disorder', 'anorexia', 'bulimia', 'purging'].some(k => lower.includes(k)))
    return 'disordered_eating';
  if (lower.includes('refund'))
    return 'refund_request';
  if (['lawyer', 'complaint'].some(k => lower.includes(k)))
    return 'complaint';
  if (["didn't work", 'did not work', 'side effect'].some(k => lower.includes(k)))
    return 'dissatisfaction';
  return 'unknown';
}

module.exports = { needsEscalation, classifyEscalation, ESCALATION_KEYWORDS };
