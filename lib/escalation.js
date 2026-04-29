const { sendWhatsApp } = require('./whatsapp');
const { getSupabase } = require('./supabase');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'purge', 'faint', 'hospital'
];

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function escalateToMaddy(reason, context) {
  const msg = `ESCALATION: ${reason}\nPhone: ${context.phone}\nName: ${context.name || 'Unknown'}\nMessage: ${context.message || 'N/A'}`;

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [reason, context.phone, context.message || 'N/A']
  });

  const supabase = getSupabase();
  await supabase.from('messages').insert({
    phone: MADDY_PHONE,
    direction: 'out',
    body: msg,
    template_name: 'escalation_alert',
    status: 'sent'
  });
}

module.exports = { needsEscalation, isOptOut, escalateToMaddy, ESCALATION_KEYWORDS };
