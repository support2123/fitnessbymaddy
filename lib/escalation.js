const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex',
  'bulimi', 'not eating', 'faint',
];

function shouldEscalate(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function notifyMaddy(reason, details) {
  const maskedDetails = details.phone
    ? { ...details, phone: maskPhone(details.phone) }
    : details;

  const msg = `ESCALATION: ${reason}\n${JSON.stringify(maskedDetails, null, 2)}`;

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [reason, JSON.stringify(maskedDetails)]);

  console.log(`[ESCALATION] ${reason}`, maskedDetails);
}

module.exports = { shouldEscalate, notifyMaddy, MADDY_PHONE };
