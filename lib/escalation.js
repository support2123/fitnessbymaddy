const { sendTemplate, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'not eating',
];

function needsEscalation(text) {
  const lower = (text || '').toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

function isOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function notifyMaddy(reason, details) {
  const params = [
    reason,
    details.phone ? maskPhone(details.phone) : 'unknown',
    details.message || details.info || '',
  ];
  await sendTemplate(MADDY_PHONE, 'escalation_alert', params);
}

module.exports = { needsEscalation, isOptOut, notifyMaddy, ESCALATION_KEYWORDS };
