const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'anorex', 'bulimi', 'purge', 'vomit'
];

function shouldEscalate(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function notifyMaddy(reason, context) {
  const msg = `🚨 ESCALATION\nReason: ${reason}\nClient: ${context.name || 'Unknown'}\nPhone: ${context.phone}\nMessage: ${(context.message || '').slice(0, 200)}`;

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [reason, context.name || 'Unknown', context.phone]
  }).catch(() => {});

  return msg;
}

module.exports = { shouldEscalate, notifyMaddy, ESCALATION_KEYWORDS };
