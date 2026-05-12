const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'not eating', 'purging', 'heart',
  'hospital', 'doctor said'
];

function needsEscalation(text) {
  if (!text) return { escalate: false };
  const lower = text.toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  if (matched.length === 0) return { escalate: false };
  return { escalate: true, reasons: matched };
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}

module.exports = { needsEscalation, isOptOut, ESCALATION_KEYWORDS };
