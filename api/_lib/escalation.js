const { sendTemplate } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex', 'bulimi',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'not working', 'scam', 'legal',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, phone, messageText) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  await sendTemplate(maddyPhone, 'escalation_alert', [
    reason,
    phone,
    (messageText || '').substring(0, 200),
  ], 'Maddy');
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
