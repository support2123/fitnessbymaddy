const { maskPhone } = require('./market');
const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'vomit',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy({ reason, phone, context }) {
  const masked = maskPhone(phone);
  const msg = `ESCALATION: ${reason}\nLead/Client: ${masked}\nContext: ${context || 'N/A'}`;

  console.log(`[ESCALATION] ${reason} for ${masked}`);

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    bodyValues: [reason, masked, context || 'Check dashboard'],
  });

  return { escalated: true };
}

function checkOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

module.exports = { needsEscalation, escalateToMaddy, checkOptOut, ESCALATION_KEYWORDS };
