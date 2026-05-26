const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./masking');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia',
  'bulimia', 'vomit', 'faint', 'chest pain', 'heart'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function escalateToMaddy(reason, phone, context) {
  const msg =
    `ESCALATION ALERT\n` +
    `Reason: ${reason}\n` +
    `From: ${maskPhone(phone)}\n` +
    `Context: ${(context || '').slice(0, 300)}\n` +
    `Action needed — check admin dashboard.`;

  await sendWhatsApp(MADDY_PHONE, msg, null, true);
  console.log(`Escalation sent to Maddy: ${reason} for ${maskPhone(phone)}`);
}

module.exports = { needsEscalation, isOptOut, escalateToMaddy, ESCALATION_KEYWORDS };
