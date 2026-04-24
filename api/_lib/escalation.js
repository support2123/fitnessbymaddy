const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'chest pain',
  'eating disorder', 'anorex', 'bulimi', 'purge', 'binge',
  'not eating', 'starving myself',
];

const MEDICAL_FLAGS = [
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'diabetes', 'thyroid', 'blood pressure', 'heart',
];

function checkEscalation(message) {
  if (!message) return { escalate: false };
  const lower = message.toLowerCase();

  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return {
        escalate: true,
        reason: `Message contains escalation trigger: "${keyword}"`,
        keyword,
      };
    }
  }
  return { escalate: false };
}

function checkMedical(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return MEDICAL_FLAGS.some(flag => lower.includes(flag));
}

function checkOptOut(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

module.exports = { checkEscalation, checkMedical, checkOptOut };
