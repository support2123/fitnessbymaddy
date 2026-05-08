const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'anorex', 'bulimi', 'purge', 'not eating'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function classifyEscalation(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (['refund', 'lawyer', 'complaint'].some(kw => lower.includes(kw))) return 'dispute';
  if (['injury', 'pregnant', 'pregnancy', 'medication', 'surgery'].some(kw => lower.includes(kw))) return 'medical';
  if (['pain', 'dizzy', 'dizziness', 'faint'].some(kw => lower.includes(kw))) return 'safety';
  if (['eating disorder', 'anorex', 'bulimi', 'purge', 'not eating'].some(kw => lower.includes(kw))) return 'eating_concern';
  if (["didn't work", 'side effect'].some(kw => lower.includes(kw))) return 'complaint';
  return null;
}

module.exports = { needsEscalation, classifyEscalation, ESCALATION_KEYWORDS };
