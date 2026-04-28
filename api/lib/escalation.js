const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'not eating', 'faint', 'hospital'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy({ reason, phone, name, message }) {
  const alert = [
    `ESCALATION ALERT`,
    `Reason: ${reason}`,
    `From: ${name || 'Unknown'} (${phone})`,
    `Message: ${message || 'N/A'}`,
    `Action needed — please review.`
  ].join('\n');

  await sendWhatsApp({
    phone: MADDY_PHONE,
    body: alert
  });
}

function checkOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

module.exports = { needsEscalation, escalateToMaddy, checkOptOut, ESCALATION_KEYWORDS };
