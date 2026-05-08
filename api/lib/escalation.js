const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'not eating',
];

function needsEscalation(text) {
  const lower = (text || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const msg = `🚨 ESCALATION: ${reason}\n\nClient: ${context.name || 'Unknown'}\nPhone: ${context.phone}\nDetails: ${context.details || 'N/A'}`;
  await sendTemplate(MADDY_PHONE, 'admin_escalation', [msg]);
  return { escalated: true, reason };
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
