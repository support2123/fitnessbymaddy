const { sendTemplate, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'not eating'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function detectEscalationReason(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

async function escalateToMaddy(reason, phone, context) {
  const msg = `ESCALATION ALERT\n` +
    `Reason: ${reason}\n` +
    `From: ${maskPhone(phone)}\n` +
    `Context: ${(context || '').slice(0, 200)}\n` +
    `Action needed — check admin dashboard.`;

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [msg]);
}

module.exports = { needsEscalation, detectEscalationReason, escalateToMaddy };
