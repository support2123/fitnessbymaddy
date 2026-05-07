const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'vomit',
  'eating disorder', 'anorexia', 'bulimia', 'purging',
  'not eating', 'starving myself',
];

function needsEscalation(messageText) {
  if (!messageText) return false;
  const lower = messageText.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(messageText) {
  if (!messageText) return false;
  const lower = messageText.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function escalateToMaddy(reason, phone, context) {
  const masked = maskPhone(phone);
  const msg = `ESCALATION: ${reason}\nLead: ${masked}\nContext: ${context}`;

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, masked, context]);

  console.log(`[ESCALATION] ${reason} for ${masked}`);
  return msg;
}

async function notifyMaddy(subject, details) {
  const msg = `${subject}: ${details}`;
  await sendTemplate(MADDY_PHONE, 'admin_notification', [subject, details]);
  return msg;
}

module.exports = { needsEscalation, isOptOut, escalateToMaddy, notifyMaddy, ESCALATION_KEYWORDS };
