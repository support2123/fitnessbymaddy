const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia', 'bulimia',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'chest pain', 'faint', 'vomit',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const msg = `ESCALATION: ${reason}\n\nContext: ${JSON.stringify(context, null, 2).substring(0, 800)}`;

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [reason, context.phone || 'unknown']);

  console.log(`[ESCALATION] ${reason} — ${context.phone || 'unknown'}`);

  return { escalated: true, reason };
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
