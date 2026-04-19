const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'disordered eating', 'eating disorder',
  'vomit', 'faint', 'chest pain', 'heart',
];

function needsEscalation(text) {
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

function getEscalationReason(text) {
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.filter((kw) => lower.includes(kw));
}

async function escalateToMaddy(phone, reason, context) {
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    phone,
    reason,
    context.substring(0, 200),
  ]);
}

module.exports = { needsEscalation, getEscalationReason, escalateToMaddy };
