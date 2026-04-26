const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex',
  'bulimi', 'not eating', 'faint', 'hospital'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}

async function notifyMaddy(reason, details) {
  const safeDetails = details.phone
    ? { ...details, phone: maskPhone(details.phone) }
    : details;

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    JSON.stringify(safeDetails).slice(0, 500)
  ]);
}

module.exports = { needsEscalation, isOptOut, notifyMaddy, ESCALATION_KEYWORDS };
