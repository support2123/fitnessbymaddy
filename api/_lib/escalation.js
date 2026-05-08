const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'not eating'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy({ reason, phone, details }) {
  const masked = maskPhone(phone);
  const msg = `🚨 ESCALATION\n\nReason: ${reason}\nLead/Client: ${masked}\n\n${details || ''}`;

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    body: [reason, masked, details || 'No additional details'],
    isClient: true
  });

  console.log(`Escalated to Maddy: ${reason} for ${masked}`);
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
