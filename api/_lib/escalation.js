const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'faint', 'chest pain', 'heart',
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

function isOptOut(message) {
  const lower = (message || '').trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function notifyMaddy(reason, details) {
  const safe = details.phone ? maskPhone(details.phone) : 'unknown';
  const body = `ESCALATION: ${reason}\nClient: ${details.name || safe}\nPhone: ${safe}\nMessage: ${(details.message || '').slice(0, 200)}`;
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [reason, safe, (details.message || '').slice(0, 100)]);
  return body;
}

module.exports = { needsEscalation, isOptOut, notifyMaddy, MADDY_PHONE };
