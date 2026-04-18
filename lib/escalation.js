const { sendMessage } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia',
  'bulimia', 'vomit', 'faint', 'chest pain', 'heart',
];

function needsEscalation(messageBody) {
  const lower = (messageBody || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(messageBody) {
  const lower = (messageBody || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function escalateToMaddy(reason, context) {
  const msg = `🚨 ESCALATION NEEDED\n\nReason: ${reason}\nClient: ${maskPhone(context.phone)}\nName: ${context.name || 'Unknown'}\nMessage: ${context.messageBody || 'N/A'}\n\nPlease review and respond directly.`;

  await sendMessage(MADDY_PHONE, {
    text: msg,
    isClient: true,
  });
}

module.exports = { needsEscalation, isOptOut, escalateToMaddy, ESCALATION_KEYWORDS };
