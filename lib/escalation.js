const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex',
  'bulimi', 'not eating', 'faint', 'chest pain', 'heart'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function classifyEscalation(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (['refund'].some(k => lower.includes(k)))
    return 'refund_request';
  if (['lawyer', 'complaint', "didn't work", 'side effect'].some(k => lower.includes(k)))
    return 'complaint';
  if (['injury', 'pain', 'dizziness', 'dizzy', 'faint', 'chest pain', 'heart'].some(k => lower.includes(k)))
    return 'medical_concern';
  if (['pregnant', 'pregnancy', 'medication', 'surgery'].some(k => lower.includes(k)))
    return 'medical_condition';
  if (['eating disorder', 'anorex', 'bulimi', 'not eating'].some(k => lower.includes(k)))
    return 'disordered_eating';

  return 'general';
}

module.exports = { needsEscalation, classifyEscalation, ESCALATION_KEYWORDS };
