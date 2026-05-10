const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'medical condition', 'surgery', 'heart', 'diabetes'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function classifyEscalation(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (['refund', 'lawyer', 'complaint'].some(k => lower.includes(k))) return 'complaint';
  if (["didn't work", 'side effect'].some(k => lower.includes(k))) return 'dissatisfaction';
  if (['injury', 'pain', 'dizziness', 'dizzy', 'surgery', 'heart', 'diabetes'].some(k => lower.includes(k))) return 'medical';
  if (['pregnant', 'pregnancy', 'medication', 'medical condition'].some(k => lower.includes(k))) return 'medical';
  if (['eating disorder', 'anorexia', 'bulimia'].some(k => lower.includes(k))) return 'eating_disorder';
  return 'general';
}

module.exports = { needsEscalation, classifyEscalation, ESCALATION_KEYWORDS };
