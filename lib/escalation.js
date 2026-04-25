const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizzy', 'dizziness', 'faint', 'chest pain',
  'eating disorder', 'anorexia', 'bulimia', 'purging',
  'not eating', 'starving myself'
];

function needsEscalation(message) {
  if (!message) return { escalate: false };
  const lower = message.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { escalate: true, trigger: keyword };
    }
  }
  return { escalate: false };
}

async function notifyMaddy(sendWhatsApp, reason, context) {
  const MADDY_PHONE = '+917082478374';
  const body = `ESCALATION ALERT\n\nReason: ${reason}\n\nContext: ${context}\n\nPlease review and respond manually.`;
  await sendWhatsApp(MADDY_PHONE, body);
}

module.exports = { needsEscalation, notifyMaddy, ESCALATION_KEYWORDS };
