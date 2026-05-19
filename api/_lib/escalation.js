const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'doctor', 'hospital',
  'pregnancy', 'pregnant', 'medication', 'medicine',
  'pain', 'dizziness', 'dizzy', 'faint', 'nausea',
  'eating disorder', 'anorexia', 'bulimia', 'binge',
  'refund', 'lawyer', 'complaint', 'legal',
  "didn't work", 'not working', 'side effect', 'side effects',
  'surgery', 'operation', 'heart', 'diabetes', 'thyroid',
  'chot', 'dard', 'doctor', 'dawai'
];

function checkEscalation(message) {
  if (!message) return { escalate: false, reason: null };
  const lower = message.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { escalate: true, reason: keyword };
    }
  }
  return { escalate: false, reason: null };
}

function checkOptOut(message) {
  if (!message) return false;
  const lower = message.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel', 'band karo', 'ruko'].includes(lower);
}

module.exports = { checkEscalation, checkOptOut };
