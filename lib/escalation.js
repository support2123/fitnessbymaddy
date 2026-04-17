const { sendTemplate, logMessage } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'not eating', 'faint', 'hospital',
];

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function escalateToMaddy(reason, phone, context = '') {
  const masked = maskPhone(phone);
  const alertMsg = `ESCALATION: ${reason}\nLead: ${masked}\n${context}`.trim();

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, masked]);
  await logMessage(MADDY_PHONE, 'out', alertMsg, 'escalation_alert');
}

module.exports = { needsEscalation, isOptOut, escalateToMaddy, MADDY_PHONE };
