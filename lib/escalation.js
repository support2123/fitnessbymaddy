const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'not eating',
  'medical condition', 'surgery', 'doctor',
];

function needsEscalation(message) {
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, leadOrClient) {
  const maskedPhone = maskPhone(leadOrClient.phone);
  const msg = `ESCALATION: ${reason}\nClient: ${leadOrClient.name || 'Unknown'} (${maskedPhone})`;
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [msg]);
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

module.exports = { needsEscalation, escalateToMaddy, maskPhone, ESCALATION_KEYWORDS };
