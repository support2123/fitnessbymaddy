const { sendWhatsApp } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'anorexia', 'bulimia',
  'vomit', 'faint', 'chest pain', 'heart'
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  await sendWhatsApp(maddyPhone, 'escalation_alert', [
    reason,
    context.phone || 'unknown',
    context.message || 'N/A',
  ]);
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
