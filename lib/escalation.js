const { sendTemplate, maskPhone } = require('./whatsapp');
const { Resend } = require('resend');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'not eating', 'fainting',
];

const MADDY_PHONE = '917082478374';

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function escalateToMaddy(reason, leadPhone, messageBody) {
  const masked = maskPhone(leadPhone);

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    masked,
    (messageBody || '').slice(0, 200),
  ]);

  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: 'FitnessByMaddy Bot <support@fitnessbymaddy.com>',
    to: 'support@fitnessbymaddy.com',
    subject: `[ESCALATION] ${reason} — ${masked}`,
    text: `Escalation triggered.\n\nReason: ${reason}\nPhone: ${masked}\nMessage: ${messageBody || 'N/A'}`,
  });
}

module.exports = { needsEscalation, isOptOut, escalateToMaddy };
