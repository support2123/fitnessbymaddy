const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'faint', 'heart', 'surgery', 'hospital',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

async function escalateToMaddy(reason, details) {
  const msg = `ESCALATION ALERT\n\nReason: ${reason}\n\n${details}\n\nPlease review and respond directly.`;
  await sendWhatsApp(MADDY_PHONE, msg);
}

module.exports = { needsEscalation, maskPhone, escalateToMaddy };
