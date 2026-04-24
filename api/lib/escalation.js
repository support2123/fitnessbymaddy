const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'vomit', 'faint', 'chest pain', 'heart',
];

function needsEscalation(text) {
  const lower = (text || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

async function notifyMaddy(reason, details) {
  const msg = `ESCALATION: ${reason}\n${details}`;
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, details]);
  return msg;
}

module.exports = { needsEscalation, isOptOut, notifyMaddy, ESCALATION_KEYWORDS };
