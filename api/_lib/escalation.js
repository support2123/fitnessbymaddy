const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'binge', 'purge',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'surgery', 'doctor', 'hospital'
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

module.exports = { needsEscalation, isOptOut };
