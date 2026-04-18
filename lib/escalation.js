const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'purging', 'faint', 'hospital',
];

function needsEscalation(messageText) {
  if (!messageText) return false;
  const lower = messageText.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function needsOptOut(messageText) {
  if (!messageText) return false;
  const lower = messageText.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function escalateToMaddy(reason, context) {
  const msg = `ESCALATION: ${reason}\nPhone: ${context.phone}\nName: ${context.name || 'Unknown'}\nMessage: ${context.message || 'N/A'}`;
  try {
    await sendTemplate(MADDY_PHONE, 'escalation_alert', [msg]);
  } catch (err) {
    console.error('Escalation send failed:', err.message);
  }
}

module.exports = { needsEscalation, needsOptOut, escalateToMaddy, ESCALATION_KEYWORDS };
