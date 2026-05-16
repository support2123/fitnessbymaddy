const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'bulimia',
  'anorexia', 'not eating', 'faint', 'fainting',
];

function needsEscalation(messageBody) {
  const lower = (messageBody || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function getEscalationReason(messageBody) {
  const lower = (messageBody || '').toLowerCase();
  return ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
}

async function escalateToMaddy(phone, reason, context = '') {
  const masked = maskPhone(phone);
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    masked,
    reason,
    context.slice(0, 200),
  ]);
}

function isOptOut(messageBody) {
  const lower = (messageBody || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe';
}

module.exports = {
  needsEscalation,
  getEscalationReason,
  escalateToMaddy,
  isOptOut,
  ESCALATION_KEYWORDS,
};
