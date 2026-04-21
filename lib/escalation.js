const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./utils');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'not eating',
];

function needsEscalation(text) {
  const lower = (text || '').toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

function isOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function notifyMaddy(reason, phone, details) {
  const maddyPhone = process.env.MADDY_PHONE;
  if (!maddyPhone) {
    console.error('MADDY_PHONE not set — escalation dropped');
    return;
  }

  const msg = `🚨 ESCALATION\nReason: ${reason}\nLead: ${maskPhone(phone)}\n${details || ''}`;
  await sendWhatsApp(maddyPhone, 'escalation_alert', [reason, maskPhone(phone), details || 'No details']);
}

module.exports = { needsEscalation, isOptOut, notifyMaddy };
