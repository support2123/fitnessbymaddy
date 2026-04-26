const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'not eating', 'fainting', 'faint'
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
  const msg = `ESCALATION: ${reason}\nPhone: ${context.phone || 'N/A'}\nName: ${context.name || 'Unknown'}\nMessage: ${(context.message || '').slice(0, 200)}`;
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [msg]);
  return true;
}

module.exports = { needsEscalation, isOptOut, escalateToMaddy, ESCALATION_KEYWORDS };
