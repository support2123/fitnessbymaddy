const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'doctor', 'pregnant', 'pregnancy',
  'medication', 'medicine', 'pain', 'dizziness', 'dizzy', 'faint',
  'eating disorder', 'anorexia', 'bulimia', 'purge', 'starving',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'chest pain', 'heart', 'surgery', 'hospital'
];

const MADDY_PHONE = '917082478374';

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function getEscalationReason(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  return matched.length > 0 ? matched.join(', ') : null;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}

module.exports = { needsEscalation, getEscalationReason, isOptOut, MADDY_PHONE, ESCALATION_KEYWORDS };
