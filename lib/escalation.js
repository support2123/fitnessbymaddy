const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex', 'bulimi',
  'faint', 'hospital', 'doctor',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, leadOrClient) {
  const name = leadOrClient.name || 'Unknown';
  const phone = leadOrClient.phone || 'N/A';
  const msg = `⚠️ ESCALATION\nReason: ${reason}\nClient: ${name}\nPhone: ${phone}`;

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, name, phone]);

  return msg;
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
