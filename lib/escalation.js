const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'vomiting', 'faint', 'chest pain', 'heart'
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function detectEscalationType(message) {
  const lower = (message || '').toLowerCase();
  if (['refund', 'lawyer', 'complaint'].some(k => lower.includes(k))) return 'complaint';
  if (['injury', 'medical', 'pregnancy', 'pregnant', 'medication'].some(k => lower.includes(k))) return 'medical';
  if (['pain', 'dizziness', 'dizzy', 'faint', 'chest pain', 'heart'].some(k => lower.includes(k))) return 'health_concern';
  if (['eating disorder', 'anorexia', 'bulimia', 'vomiting'].some(k => lower.includes(k))) return 'eating_disorder';
  return 'unknown';
}

async function escalateToMaddy(phone, clientName, reason, originalMessage) {
  const alertBody = `🚨 ESCALATION ALERT\n\nClient: ${clientName || 'Unknown'}\nPhone: ${phone}\nType: ${reason}\n\nMessage: "${originalMessage}"`;

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [clientName || 'A client', reason, originalMessage.slice(0, 200)]
  }, alertBody);
}

module.exports = { needsEscalation, detectEscalationType, escalateToMaddy, ESCALATION_KEYWORDS };
