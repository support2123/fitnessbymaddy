const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'bulimi', 'anorexi',
  'not eating', 'faint', 'hospital', 'doctor', 'surgery'
];

function checkEscalation(message) {
  const lower = (message || '').toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return keyword;
    }
  }
  return null;
}

async function notifyMaddy(reason, context) {
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
    reason,
    context.phone || 'unknown',
    context.detail || '',
  ]);
}

module.exports = { checkEscalation, notifyMaddy, ESCALATION_KEYWORDS };
