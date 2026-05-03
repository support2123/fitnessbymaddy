const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'not eating', 'vomiting',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, details) {
  const msg = `ESCALATION: ${reason}\n${details}`;
  console.warn(`[ESCALATION] ${reason} - ${details}`);

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    bodyValues: [reason, details],
  });

  return true;
}

async function checkAndEscalate(phone, messageText) {
  if (!needsEscalation(messageText)) return false;

  await escalateToMaddy(
    'Flagged message received',
    `From: ${maskPhone(phone)}\nMessage: ${messageText.slice(0, 200)}`
  );
  return true;
}

module.exports = { needsEscalation, escalateToMaddy, checkAndEscalate };
