const { getSupabase } = require('./supabase');
const { sendText, maskPhone } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex',
  'bulimi', 'not eating', 'faint', 'hospital',
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

async function escalate(phone, reason, messageBody) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody,
  });

  const masked = maskPhone(phone);
  await sendText(
    MADDY_PHONE,
    `🚨 ESCALATION\nLead/Client: ${masked}\nReason: ${reason}\nMsg: "${(messageBody || '').slice(0, 100)}"\n\nPlease review in the admin dashboard.`
  );
}

module.exports = { needsEscalation, isOptOut, escalate };
