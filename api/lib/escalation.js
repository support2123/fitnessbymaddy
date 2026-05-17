const { supabase } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'not eating',
  'surgery', 'hospital', 'doctor said'
];

function shouldEscalate(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.find(kw => lower.includes(kw)) || null;
}

async function createEscalation({ clientId, leadId, phone, reason, triggerMessage }) {
  await supabase.from('escalations').insert({
    client_id: clientId || null,
    lead_id: leadId || null,
    phone,
    reason,
    trigger_message: triggerMessage
  });

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [reason, phone ? phone.slice(-4) : 'unknown']
  }, true);
}

module.exports = { shouldEscalate, createEscalation, ESCALATION_KEYWORDS };
