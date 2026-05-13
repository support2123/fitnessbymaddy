const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'injured', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'not eating', 'starving', 'faint', 'fainting'
];

function checkEscalation(message) {
  const lower = (message || '').toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { escalate: true, reason: `Message contains "${keyword}"` };
    }
  }
  return { escalate: false };
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

module.exports = { checkEscalation, maskPhone, ESCALATION_KEYWORDS };
