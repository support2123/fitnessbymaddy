const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder', 'anorexia', 'bulimia',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'not working', 'cancel', 'stop',
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
  const msg = `🚨 ESCALATION\nReason: ${reason}\n\nContext:\n${JSON.stringify(context, null, 2).substring(0, 500)}`;
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, context.phone || 'unknown']);
  return true;
}

module.exports = { needsEscalation, isOptOut, escalateToMaddy, ESCALATION_KEYWORDS };
