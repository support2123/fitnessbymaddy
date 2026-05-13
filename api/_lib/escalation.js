const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'not working', 'worse', 'hospital', 'doctor said', 'surgery'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function classifyEscalation(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (['injury', 'pain', 'dizziness', 'dizzy', 'hospital', 'surgery'].some(k => lower.includes(k)))
    return 'health_concern';
  if (['pregnant', 'pregnancy'].some(k => lower.includes(k)))
    return 'pregnancy';
  if (['medication', 'medical', 'doctor said'].some(k => lower.includes(k)))
    return 'medical';
  if (['eating disorder', 'anorexia', 'bulimia'].some(k => lower.includes(k)))
    return 'disordered_eating';
  if (['refund'].some(k => lower.includes(k)))
    return 'refund_request';
  if (['lawyer', 'complaint', "didn't work", 'side effect', 'not working', 'worse'].some(k => lower.includes(k)))
    return 'complaint';
  return 'general';
}

module.exports = { needsEscalation, classifyEscalation, ESCALATION_KEYWORDS };
