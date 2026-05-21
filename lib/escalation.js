const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorex', 'bulimi', 'purge', 'not eating',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy({ reason, phone, details }) {
  const masked = maskPhone(phone);
  const message = [
    `ESCALATION: ${reason}`,
    `Lead/Client: ${masked}`,
    details ? `Details: ${details.slice(0, 200)}` : '',
  ].filter(Boolean).join('\n');

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    bodyValues: [reason, masked, (details || '').slice(0, 100)],
  });

  return { escalated: true, reason };
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
