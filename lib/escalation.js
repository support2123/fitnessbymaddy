const { getSupabase } = require('./supabase');
const { sendTemplate, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'not eating', 'binge', 'purge', 'vomit'
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function createEscalation(phone, reason, messageBody, clientId) {
  const db = getSupabase();
  await db.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', {
    isClient: true,
    templateParams: [
      reason,
      maskPhone(phone),
      (messageBody || '').slice(0, 200)
    ]
  });
}

module.exports = { needsEscalation, createEscalation, ESCALATION_KEYWORDS };
