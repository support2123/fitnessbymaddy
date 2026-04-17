const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./mask');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex',
  'bulimi', 'not eating', 'faint', 'heart'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, details) {
  const msg = `ESCALATION: ${reason}\n${details}`;
  console.log(`Escalating: ${reason}`);
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [reason, details]);
  return { escalated: true };
}

async function checkAndEscalate(phone, messageText, context) {
  if (!needsEscalation(messageText)) return false;

  await escalateToMaddy(
    context || 'Message flagged',
    `From: ${maskPhone(phone)}\nMessage: ${messageText.substring(0, 200)}`
  );
  return true;
}

module.exports = { needsEscalation, escalateToMaddy, checkAndEscalate, MADDY_PHONE };
