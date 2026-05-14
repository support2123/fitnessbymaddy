const { supabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'not eating'
];

function needsEscalation(messageText) {
  if (!messageText) return false;
  const lower = messageText.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const alert = `ESCALATION: ${reason}\n${context}`;

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, context], true);

  await supabase.from('messages').insert({
    phone: MADDY_PHONE,
    direction: 'out',
    body: alert,
    template_name: 'escalation_alert',
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

function isOptOut(messageText) {
  if (!messageText) return false;
  const lower = messageText.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}

module.exports = { needsEscalation, escalateToMaddy, isOptOut, ESCALATION_KEYWORDS };
