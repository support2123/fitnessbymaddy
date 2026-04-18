const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'condition', 'pregnant', 'pregnancy',
  'medication', 'medicine', 'pain', 'dizziness', 'dizzy',
  'eating disorder', 'anorexia', 'bulimia', 'purge', 'binge',
  'refund', 'lawyer', 'legal', 'complaint',
  "didn't work", 'did not work', 'side effect', 'side effects',
];

function needsEscalation(text) {
  if (!text) return { escalate: false, keywords: [], reason: null };
  const lower = text.toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  return {
    escalate: matched.length > 0,
    keywords: matched,
    reason: matched.length > 0 ? `Message contains: ${matched.join(', ')}` : null,
  };
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

module.exports = { needsEscalation, maskPhone, ESCALATION_KEYWORDS };
