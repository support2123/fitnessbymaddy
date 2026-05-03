const { sendText } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'purge', 'purging', 'not eating', "can't eat"
];

function needsEscalation(messageText) {
  if (!messageText) return false;
  const lower = messageText.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const phone = process.env.MADDY_PHONE || '+917082478374';
  const msg = [
    '--- ESCALATION ---',
    `Reason: ${reason}`,
    `Client: ${context.name || 'Unknown'} (${context.phone || 'N/A'})`,
    context.details ? `Details: ${context.details}` : '',
    `Time: ${new Date().toISOString()}`
  ].filter(Boolean).join('\n');

  await sendText(phone, msg, true);
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
