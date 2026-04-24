const { sendText } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'not eating',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, details, { supabase }) {
  const msg =
    `ESCALATION ALERT\n` +
    `Reason: ${reason}\n` +
    `Details: ${details}\n` +
    `Time: ${new Date().toISOString()}`;

  await sendText(MADDY_PHONE, msg, { supabase });
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
