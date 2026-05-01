const { sendTemplate } = require('./whatsapp');
const { Resend } = require('resend');

const MADDY_PHONE = '+917082478374';
const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex',
  'bulimi', 'purging', 'faint',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    context.phone || 'unknown',
    context.detail || '',
  ]);

  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: 'FitnessByMaddy Alerts <support@fitnessbymaddy.com>',
    to: 'support@fitnessbymaddy.com',
    subject: `[ESCALATION] ${reason}`,
    text: `Reason: ${reason}\nPhone: ${context.phone || 'unknown'}\nDetail: ${context.detail || 'N/A'}\nTime: ${new Date().toISOString()}`,
  });
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
