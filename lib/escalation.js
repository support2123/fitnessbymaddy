const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia',
  'bulimia', 'vomiting', 'faint', 'chest pain'
];

function needsEscalation(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function escalateToMaddy(reason, context) {
  const msg = [
    '--- ESCALATION ALERT ---',
    `Reason: ${reason}`,
    `Phone: ${maskPhone(context.phone || '')}`,
    `Name: ${context.name || 'Unknown'}`,
    `Message: ${(context.message || '').slice(0, 200)}`,
    `Client ID: ${context.clientId || 'N/A'}`,
    '--- END ---'
  ].join('\n');

  await sendWhatsApp(MADDY_PHONE, msg, null, true);
}

module.exports = { needsEscalation, isOptOut, escalateToMaddy, ESCALATION_KEYWORDS };
