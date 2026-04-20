const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'pain', 'dizziness', 'dizzy', 'pregnant', 'pregnancy',
  'medication', 'medical', 'surgery', 'doctor', 'hospital',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'eating disorder', 'anorex', 'bulimi', 'not eating', 'binge',
  'vomit', 'faint', 'chest pain', 'heart'
];

function needsEscalation(text) {
  if (!text) return { escalate: false };
  const lower = text.toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  if (matched.length > 0) {
    return { escalate: true, reasons: matched };
  }
  return { escalate: false };
}

function buildEscalationAlert(phone, text, reasons) {
  return `ESCALATION ALERT\nPhone: ${phone}\nMessage: "${text}"\nTriggers: ${reasons.join(', ')}\nAction required: Please review and respond manually.`;
}

module.exports = { needsEscalation, buildEscalationAlert, ESCALATION_KEYWORDS };
