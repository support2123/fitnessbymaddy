const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'vomit', 'faint', 'chest pain', 'heart', 'surgery'
];

function checkEscalation(messageBody) {
  if (!messageBody) return { escalate: false, triggers: [] };
  const lower = messageBody.toLowerCase();
  const triggers = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  return { escalate: triggers.length > 0, triggers };
}

module.exports = { checkEscalation, ESCALATION_KEYWORDS };
