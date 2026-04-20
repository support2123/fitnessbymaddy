const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'surgery', 'doctor said', 'hospital'
];

function needsEscalation(message) {
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy({ reason, phone, message }) {
  const masked = phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
  const body = `🚨 ESCALATION\nReason: ${reason}\nFrom: ${masked}\nMsg: "${message.slice(0, 100)}"`;

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    params: [reason, masked, message.slice(0, 80)]
  });

  return true;
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
