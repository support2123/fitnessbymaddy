const { sendText, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'not eating', 'purging', 'vomiting',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, details) {
  const msg = `ESCALATION ALERT\n\nReason: ${reason}\n\nDetails: ${details}\n\nPlease review and respond.`;
  try {
    await sendText(MADDY_PHONE, msg);
  } catch (err) {
    console.error('Escalation send failed for', maskPhone(MADDY_PHONE), err.message);
  }
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
