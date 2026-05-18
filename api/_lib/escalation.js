const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'not eating'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function classifyEscalation(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (['refund', 'lawyer', 'complaint'].some(k => lower.includes(k))) return 'dispute';
  if (['injury', 'pregnant', 'pregnancy', 'medication', 'surgery'].some(k => lower.includes(k))) return 'medical';
  if (['pain', 'dizziness', 'dizzy', 'faint'].some(k => lower.includes(k))) return 'health_concern';
  if (['eating disorder', 'anorexia', 'bulimia', 'purging', 'not eating'].some(k => lower.includes(k))) return 'disordered_eating';
  return null;
}

module.exports = { needsEscalation, classifyEscalation, ESCALATION_KEYWORDS };
