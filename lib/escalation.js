const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'binge', 'purge', 'not eating',
  'medical condition', 'doctor said', 'hospital'
];

function needsEscalation(text) {
  if (!text) return { escalate: false };
  const lower = text.toLowerCase();

  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { escalate: true, trigger: keyword };
    }
  }
  return { escalate: false };
}

async function notifyMaddy(reason, context) {
  const msg = [
    `ALERT: ${reason}`,
    context.clientName ? `Client: ${context.clientName}` : '',
    context.phone ? `Phone: ${context.phone}` : '',
    context.details || ''
  ].filter(Boolean).join('\n');

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [msg]);
}

module.exports = { needsEscalation, notifyMaddy };
