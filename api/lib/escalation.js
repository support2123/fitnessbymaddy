const { getSupabase } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'not eating',
];

function needsEscalation(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function escalateToMaddy({ phone, reason, messageBody, clientId }) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody,
  });

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    bodyValues: [
      reason,
      maskPhone(phone),
      (messageBody || '').slice(0, 200),
    ],
  });

  console.log(`Escalated: ${reason} from ${maskPhone(phone)}`);
}

module.exports = { needsEscalation, isOptOut, escalateToMaddy, ESCALATION_KEYWORDS };
