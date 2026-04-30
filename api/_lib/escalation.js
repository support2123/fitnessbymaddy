const { getSupabase } = require('./supabase');
const { sendTemplate, maskPhone } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'not eating', 'faint', 'chest pain',
];

function needsEscalation(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

async function createEscalation(phone, reason, messageBody, clientId) {
  const db = getSupabase();
  await db.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody,
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    maskPhone(phone),
    (messageBody || '').slice(0, 100),
  ]);
}

module.exports = { needsEscalation, createEscalation };
