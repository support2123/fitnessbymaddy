const { supabase } = require('./supabase');
const { sendWhatsApp, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex', 'bulimi',
  'not eating', 'starving', 'purge', 'vomit'
];

function needsEscalation(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

async function createEscalation(phone, triggerType, triggerMessage, clientId) {
  const { data, error } = await supabase.from('escalations').insert({
    phone,
    client_id: clientId || null,
    trigger_type: triggerType,
    trigger_message: triggerMessage
  }).select().single();

  if (error) {
    console.error('Failed to create escalation:', error.message);
    return;
  }

  // Notify Maddy
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
    triggerType,
    maskPhone(phone),
    triggerMessage ? triggerMessage.slice(0, 100) : 'N/A'
  ], true);

  return data;
}

module.exports = { needsEscalation, createEscalation, ESCALATION_KEYWORDS };
