const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'not working', 'scam', 'fraud',
];

const MEDICAL_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'surgery', 'doctor',
];

function checkEscalation(message) {
  const lower = (message || '').toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  if (matched.length === 0) return null;

  const isMedical = matched.some(kw => MEDICAL_KEYWORDS.includes(kw));
  return {
    triggers: matched,
    severity: isMedical ? 'medical' : 'complaint',
    message,
  };
}

async function notifyMaddy(context) {
  const alert = `ESCALATION ALERT\n` +
    `Type: ${context.severity}\n` +
    `Triggers: ${context.triggers.join(', ')}\n` +
    `From: ${context.phone || 'unknown'}\n` +
    `Message: ${context.message.slice(0, 200)}`;

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    context.severity,
    context.triggers.join(', '),
    context.message.slice(0, 100),
  ]);

  return alert;
}

module.exports = { checkEscalation, notifyMaddy, ESCALATION_KEYWORDS };
