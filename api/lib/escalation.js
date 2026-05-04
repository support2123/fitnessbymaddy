const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'not eating',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const msg = `ALERT: ${reason}\nLead/Client: ${maskPhone(context.phone || 'unknown')}\nDetails: ${context.details || 'N/A'}`;
  console.warn(`[ESCALATION] ${msg}`);
  try {
    await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, context.details || '']);
  } catch (err) {
    console.error('Failed to send escalation to Maddy:', err.message);
  }
}

function checkOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}

module.exports = { needsEscalation, escalateToMaddy, checkOptOut, MADDY_PHONE };
