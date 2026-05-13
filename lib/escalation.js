const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'purge',
  'vomit', 'faint', 'chest pain', 'heart'
];

function needsEscalation(message) {
  const lower = String(message).toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy({ reason, phone, context }) {
  const masked = maskPhone(phone);
  const body = `ESCALATION ALERT\n\nReason: ${reason}\nClient: ${masked}\nContext: ${context}\n\nPlease review and respond manually.`;

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    body,
    params: [reason, masked]
  });
}

function classifyEscalationReason(message) {
  const lower = String(message).toLowerCase();
  if (lower.includes('refund')) return 'Refund request';
  if (lower.includes('lawyer') || lower.includes('complaint')) return 'Legal/complaint';
  if (lower.includes('pain') || lower.includes('dizzy') || lower.includes('faint') || lower.includes('chest')) return 'Health concern';
  if (lower.includes('injury')) return 'Injury reported';
  if (lower.includes('pregnant') || lower.includes('pregnancy')) return 'Pregnancy';
  if (lower.includes('medication') || lower.includes('medical')) return 'Medical condition';
  if (lower.includes('eating disorder') || lower.includes('purge') || lower.includes('vomit')) return 'Disordered eating signals';
  if (lower.includes("didn't work") || lower.includes('side effect')) return 'Negative experience';
  return 'Requires review';
}

module.exports = { needsEscalation, escalateToMaddy, classifyEscalationReason };
