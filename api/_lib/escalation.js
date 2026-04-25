const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'not eating'
];

const MEDICAL_KEYWORDS = [
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'diabetes', 'thyroid', 'heart condition', 'blood pressure'
];

function checkEscalation(text) {
  const lower = (text || '').toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) {
      const isMedical = MEDICAL_KEYWORDS.some(mk => lower.includes(mk));
      return {
        shouldEscalate: true,
        reason: isMedical ? `Medical flag: "${kw}"` : `Escalation keyword: "${kw}"`,
        keyword: kw
      };
    }
  }
  return { shouldEscalate: false };
}

function checkOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

module.exports = { checkEscalation, checkOptOut };
