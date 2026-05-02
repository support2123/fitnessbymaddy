const { getSupabase } = require('./supabase');
const { sendTextMessage, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'vomiting', 'faint', 'chest pain', 'heart'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function createEscalation(phone, reason, messageBody, clientId) {
  const db = getSupabase();
  await db.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody
  });

  await sendTextMessage(
    MADDY_PHONE,
    `ESCALATION from ${maskPhone(phone)}: ${reason}\n\nMessage: "${(messageBody || '').slice(0, 200)}"`
  );
}

module.exports = { needsEscalation, isOptOut, createEscalation, ESCALATION_KEYWORDS };
