const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'vomit',
  'eating disorder', 'anorexia', 'bulimia', 'purging',
  'not eating', 'starving myself'
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
  if (['injury', 'pregnant', 'pregnancy', 'medication', 'surgery'].some(k => lower.includes(k))) return 'medical';
  if (['pain', 'dizzy', 'dizziness', 'faint', 'vomit'].some(k => lower.includes(k))) return 'health_concern';
  if (['eating disorder', 'anorexia', 'bulimia', 'purging', 'not eating', 'starving'].some(k => lower.includes(k))) return 'disordered_eating';
  return null;
}

module.exports = { needsEscalation, classifyEscalation, ESCALATION_KEYWORDS };
