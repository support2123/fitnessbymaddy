const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorex', 'bulimi',
  'vomit', 'faint', 'chest pain', 'heart'
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

async function escalateToMaddy(reason, context) {
  const msg = `🚨 ESCALATION\n\nReason: ${reason}\n\nContext:\n${JSON.stringify(context, null, 2)}`;
  await sendWhatsApp(MADDY_PHONE, { text: msg, isClient: true });
}

module.exports = { needsEscalation, isOptOut, escalateToMaddy, ESCALATION_KEYWORDS };
