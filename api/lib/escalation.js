const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'medical condition', 'surgery', 'doctor said',
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

async function notifyMaddy(reason, details) {
  try {
    await sendTemplate(MADDY_PHONE, 'escalation_alert', [
      reason,
      details || 'No additional details',
    ]);
  } catch (err) {
    console.error('Failed to notify Maddy:', err.message);
  }
}

module.exports = { needsEscalation, isOptOut, notifyMaddy, MADDY_PHONE };
