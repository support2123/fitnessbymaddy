const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex',
  'bulimi', 'faint', 'chest pain', 'heart'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    params: [reason, context]
  });
}

module.exports = { needsEscalation, escalateToMaddy, MADDY_PHONE };
