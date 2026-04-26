const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'not eating'
];

const MEDICAL_KEYWORDS = [
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'diabetes', 'thyroid', 'heart condition', 'blood pressure',
  'epilepsy', 'asthma'
];

function needsEscalation(text) {
  if (!text) return { escalate: false };
  const lower = text.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) {
      return { escalate: true, reason: kw, type: getMedical(kw) ? 'medical' : 'complaint' };
    }
  }
  return { escalate: false };
}

function getMedical(keyword) {
  return MEDICAL_KEYWORDS.some(m => keyword.includes(m));
}

function needsOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

module.exports = { needsEscalation, needsOptOut, ESCALATION_KEYWORDS };
