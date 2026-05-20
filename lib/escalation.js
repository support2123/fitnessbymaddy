const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'condition', 'pregnancy', 'pregnant',
  'medication', 'medicine', 'pain', 'dizziness', 'dizzy', 'faint',
  'eating disorder', 'anorexia', 'bulimia', 'purging', 'binge',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'chest pain', 'heart', 'surgery', 'doctor', 'hospital',
];

function checkEscalation(message) {
  if (!message) return { escalate: false };
  const lower = message.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { escalate: true, reason: `Message contains "${keyword}"`, keyword };
    }
  }
  return { escalate: false };
}

function checkOptOut(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}

module.exports = { checkEscalation, checkOptOut, ESCALATION_KEYWORDS };
