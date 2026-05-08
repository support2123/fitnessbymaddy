const { sendTemplate } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex', 'bulimi',
  'not eating', 'throwing up', 'vomit',
];

function needsEscalation(text) {
  const lower = (text || '').toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

async function escalateToMaddy(reason, phone, messageText) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  await sendTemplate(maddyPhone, 'escalation_alert', [
    reason,
    maskPhone(phone),
    (messageText || '').slice(0, 200),
  ]);
}

module.exports = { needsEscalation, escalateToMaddy, maskPhone };
