const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'vomit', 'faint', 'chest pain', 'heart',
  'surgery', 'doctor', 'hospital'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function classifyEscalation(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (['refund', 'lawyer', 'complaint', "didn't work"].some(k => lower.includes(k))) {
    return 'complaint_or_refund';
  }
  if (['injury', 'pain', 'dizziness', 'dizzy', 'faint', 'chest pain', 'heart', 'surgery', 'hospital'].some(k => lower.includes(k))) {
    return 'medical_concern';
  }
  if (['pregnant', 'pregnancy', 'medication', 'medicine', 'doctor'].some(k => lower.includes(k))) {
    return 'medical_condition';
  }
  if (['eating disorder', 'anorexia', 'bulimia', 'vomit'].some(k => lower.includes(k))) {
    return 'disordered_eating';
  }
  return 'general';
}

module.exports = { needsEscalation, classifyEscalation, ESCALATION_KEYWORDS };
