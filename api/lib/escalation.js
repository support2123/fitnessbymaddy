const { sendWhatsApp, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex',
  'bulimi', 'purge', 'faint', 'chest pain', 'heart',
];

function needsEscalation(text) {
  const lower = (text || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const masked = maskPhone(context.phone || '');
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
    reason,
    context.name || 'Unknown',
    masked,
    (context.message || '').slice(0, 200),
  ]);
}

function isOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe';
}

module.exports = { needsEscalation, escalateToMaddy, isOptOut, ESCALATION_KEYWORDS };
