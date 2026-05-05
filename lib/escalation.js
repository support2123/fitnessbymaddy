const { sendText, maskPhone } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex',
  'bulimi', 'not eating', 'faint',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, phone, context) {
  const msg =
    `ESCALATION ALERT\n` +
    `Reason: ${reason}\n` +
    `Lead/Client: ${maskPhone(phone)}\n` +
    `Context: ${context || 'N/A'}\n` +
    `Action needed — please review.`;

  await sendText(MADDY_PHONE, msg);
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

module.exports = { needsEscalation, escalateToMaddy, isOptOut, ESCALATION_KEYWORDS };
