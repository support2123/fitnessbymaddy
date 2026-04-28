const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorex', 'bulimi', 'purge', 'not eating'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy({ reason, phone, clientName, message }) {
  const alert = [
    `ESCALATION ALERT`,
    `Reason: ${reason}`,
    `From: ${clientName || 'Unknown'} (${maskPhone(phone)})`,
    `Message: ${(message || '').slice(0, 200)}`
  ].join('\n');

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    body: alert,
    params: [reason, clientName || 'Lead', maskPhone(phone)]
  });

  console.log(`Escalated to Maddy: ${reason} from ${maskPhone(phone)}`);
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
