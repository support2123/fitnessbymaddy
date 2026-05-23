const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'not eating',
  'medical condition', 'surgery', 'doctor said'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy({ reason, phone, name, message }) {
  const masked = phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
  const alert = `ESCALATION ALERT\nReason: ${reason}\nClient: ${name || 'Unknown'} (${masked})\nMessage: "${message?.slice(0, 200) || 'N/A'}"`;

  await sendWhatsApp({
    phone: MADDY_PHONE,
    message: alert,
  });
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
