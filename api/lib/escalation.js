const { supabase } = require('./supabase');
const { sendWhatsApp, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'purging', 'not eating'
];

function shouldEscalate(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalate(phone, reason, messageBody, clientId) {
  await supabase.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody
  });

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [
      reason,
      maskPhone(phone),
      (messageBody || '').slice(0, 100)
    ]
  });

  return true;
}

module.exports = { shouldEscalate, escalate, ESCALATION_KEYWORDS };
