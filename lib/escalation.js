const { sendWhatsApp } = require('./whatsapp');
const { Resend } = require('resend');

const MADDY_PHONE = '+917082478374';

async function escalateToMaddy({ reason, phone, name, message, context }) {
  const summary = [
    `ESCALATION: ${reason}`,
    `Client: ${name || 'Unknown'} (${phone})`,
    message ? `Message: "${message}"` : '',
    context ? `Context: ${context}` : '',
  ].filter(Boolean).join('\n');

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    bodyValues: [reason, name || 'Unknown', phone],
  });

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'FitnessByMaddy Bot <support@fitnessbymaddy.com>',
      to: 'support@fitnessbymaddy.com',
      subject: `[ESCALATION] ${reason} — ${name || phone}`,
      text: summary,
    });
  } catch (err) {
    console.error('Email escalation failed:', err.message);
  }

  return { escalated: true, reason };
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
];

function shouldEscalate(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

module.exports = { escalateToMaddy, shouldEscalate, ESCALATION_KEYWORDS };
