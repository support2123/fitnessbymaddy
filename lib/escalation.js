const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'chest pain', 'faint', 'vomit', 'blood pressure', 'surgery', 'doctor'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function classifyEscalation(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (['refund', 'lawyer', 'complaint'].some(kw => lower.includes(kw))) return 'refund_dispute';
  if (['injury', 'pain', 'dizziness', 'dizzy', 'faint', 'chest pain', 'vomit', 'blood pressure'].some(kw => lower.includes(kw))) return 'medical';
  if (['pregnancy', 'pregnant'].some(kw => lower.includes(kw))) return 'pregnancy';
  if (['eating disorder', 'anorexia', 'bulimia'].some(kw => lower.includes(kw))) return 'eating_disorder';
  if (['medication', 'surgery', 'doctor', 'medical'].some(kw => lower.includes(kw))) return 'medical';
  if (["didn't work", 'side effect'].some(kw => lower.includes(kw))) return 'complaint';
  return 'general';
}

module.exports = { needsEscalation, classifyEscalation, ESCALATION_KEYWORDS };
