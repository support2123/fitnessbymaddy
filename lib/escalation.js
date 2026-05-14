const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./pii');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'vomiting', 'faint', 'chest pain', 'heart'
];

function needsEscalation(text) {
  const lower = (text || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function notifyMaddy(reason, phone, context) {
  const maddyPhone = process.env.MADDY_PHONE;
  if (!maddyPhone) {
    console.error('MADDY_PHONE not set — escalation dropped');
    return;
  }

  await sendTemplate(maddyPhone, 'escalation_alert', [
    reason,
    maskPhone(phone),
    (context || '').slice(0, 200)
  ]);
}

module.exports = { needsEscalation, isOptOut, notifyMaddy };
