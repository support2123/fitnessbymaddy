const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'condition', 'pregnant', 'pregnancy',
  'medication', 'medicine', 'pain', 'dizziness', 'dizzy', 'faint',
  'eating disorder', 'anorexia', 'bulimia', 'binge', 'purge',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'side effects', 'hospital', 'doctor', 'surgery'
];

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function notifyMaddy(reason, context) {
  const { sendWhatsApp } = require('./whatsapp');
  const maddyPhone = '+917082478374';
  const body = `ESCALATION ALERT\n\nReason: ${reason}\nPhone: ${context.phone || 'N/A'}\nName: ${context.name || 'Unknown'}\nMessage: ${(context.message || '').slice(0, 200)}\n\nPlease review and respond manually.`;
  await sendWhatsApp(maddyPhone, body);
}

module.exports = { needsEscalation, notifyMaddy, ESCALATION_KEYWORDS };
