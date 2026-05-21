const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'doctor', 'hospital',
  'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizziness', 'dizzy', 'faint', 'chest pain',
  'eating disorder', 'anorexia', 'bulimia', 'binge',
  'refund', 'lawyer', 'complaint', 'legal',
  'didn\'t work', 'not working', 'side effect', 'side effects',
  'vomit', 'blood pressure', 'diabetes', 'thyroid', 'surgery'
];

const OPTOUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel messages'];

function checkEscalation(message) {
  if (!message) return { escalate: false, optout: false, reasons: [] };
  const lower = message.toLowerCase();

  const optout = OPTOUT_KEYWORDS.some(k => lower.includes(k));
  const reasons = ESCALATION_KEYWORDS.filter(k => lower.includes(k));

  return {
    escalate: reasons.length > 0,
    optout,
    reasons
  };
}

module.exports = { checkEscalation };
