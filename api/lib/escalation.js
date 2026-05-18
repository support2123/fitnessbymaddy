const { notifyMaddy, maskPhone } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'not eating', 'binge', 'purge', 'vomit'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateIfNeeded(phone, text) {
  if (!needsEscalation(text)) return false;

  const matched = ESCALATION_KEYWORDS.filter(kw =>
    text.toLowerCase().includes(kw)
  );

  await notifyMaddy(
    'Message needs review',
    `From: ${maskPhone(phone)}\nKeywords: ${matched.join(', ')}\nMessage: ${text.slice(0, 200)}`
  );
  return true;
}

module.exports = { needsEscalation, escalateIfNeeded };
