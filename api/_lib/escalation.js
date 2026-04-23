const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorex', 'bulimi', 'purge', 'not eating',
];

function needsEscalation(message) {
  if (!message) return false;
  const msg = message.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => msg.includes(kw));
}

function escalationReason(message) {
  if (!message) return 'unknown';
  const msg = message.toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter((kw) => msg.includes(kw));
  return matched.join(', ');
}

async function notifyMaddy(context) {
  const { phone, reason, message, type } = context;
  const alert = [
    `ALERT: ${type || 'Escalation'}`,
    `From: ${maskPhone(phone)}`,
    `Reason: ${reason}`,
    message ? `Msg: "${message.slice(0, 100)}"` : '',
  ].filter(Boolean).join('\n');

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [alert]);
}

module.exports = { needsEscalation, escalationReason, notifyMaddy };
