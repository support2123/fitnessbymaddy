const { sendText } = require('./whatsapp');
const { Resend } = require('resend');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'not eating', 'starving', 'faint', 'hospital'
];

function checkEscalation(message) {
  if (!message) return { escalate: false };
  const lower = message.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) {
      return { escalate: true, trigger: kw };
    }
  }
  return { escalate: false };
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function notifyMaddy(subject, details) {
  await sendText(
    MADDY_PHONE,
    `ESCALATION: ${subject}\n\n${details}`
  );

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'FitnessByMaddy Automation <support@fitnessbymaddy.com>',
      to: 'support@fitnessbymaddy.com',
      subject: `[ESCALATION] ${subject}`,
      text: details
    });
  } catch (_) {
    // Email is best-effort; WhatsApp is the primary channel
  }
}

module.exports = { checkEscalation, isOptOut, notifyMaddy };
