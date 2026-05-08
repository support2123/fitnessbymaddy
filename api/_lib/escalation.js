const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./pii');
const { Resend } = require('resend');

const MADDY_PHONE = '+917082478374';
const MADDY_EMAIL = process.env.MADDY_EMAIL || 'maddy@fitnessbymaddy.com';
const FROM_EMAIL = 'support@fitnessbymaddy.com';

const ESCALATION_KEYWORDS = [
  'injury',
  'medical',
  'pregnant',
  'pregnancy',
  'medication',
  'pain',
  'dizziness',
  'dizzy',
  'eating disorder',
  'anorexia',
  'bulimia',
  'refund',
  'lawyer',
  'complaint',
  "didn't work",
  'side effect',
  'not working',
];

// ---------------------------------------------------------------------------
// Check message text for escalation triggers and notify Maddy
// ---------------------------------------------------------------------------
async function checkAndEscalate(phone, messageText, context) {
  if (!messageText) return { escalated: false };

  const lower = messageText.toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter((kw) => lower.includes(kw));

  if (matched.length === 0) return { escalated: false };

  const masked = maskPhone(phone);
  const summary = [
    `Escalation triggered for ${masked}`,
    `Keywords: ${matched.join(', ')}`,
    `Message: ${messageText}`,
    context ? `Context: ${JSON.stringify(context)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const errors = [];

  // 1. WhatsApp alert to Maddy
  try {
    await sendTemplate(MADDY_PHONE, 'escalation_alert', {
      name: 'Maddy',
      templateParams: [masked, matched.join(', '), messageText.slice(0, 200)],
    });
  } catch (err) {
    console.error('Escalation WhatsApp failed:', err.message);
    errors.push(err.message);
  }

  // 2. Email alert via Resend
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM_EMAIL,
      to: MADDY_EMAIL,
      subject: `Escalation: ${matched[0]} from ${masked}`,
      text: summary,
    });
  } catch (err) {
    console.error('Escalation email failed:', err.message);
    errors.push(err.message);
  }

  return {
    escalated: true,
    keywords: matched,
    errors: errors.length > 0 ? errors : undefined,
  };
}

module.exports = { checkAndEscalate };
