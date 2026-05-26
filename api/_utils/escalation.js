const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'doctor', 'hospital',
  'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizziness', 'dizzy', 'faint', 'vomit',
  'eating disorder', 'anorexia', 'bulimia', 'purge', 'binge',
  'refund', 'lawyer', 'complaint', 'legal',
  "didn't work", 'didnt work', 'not working', 'scam',
  'side effect', 'side effects'
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel messages'];

function checkEscalation(message) {
  const lower = (message || '').toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) {
      return { escalate: true, reason: `Message contains: "${kw}"` };
    }
  }
  return { escalate: false };
}

function checkOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(kw => lower === kw || lower.includes(kw));
}

module.exports = { checkEscalation, checkOptOut, ESCALATION_KEYWORDS };
