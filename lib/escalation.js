const { notifyMaddy, maskPhone } = require('./whatsapp');
const { getSupabase } = require('./supabase');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'not eating', 'vomiting',
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

async function escalate(phone, reason, message) {
  const db = getSupabase();
  const masked = maskPhone(phone);

  await db
    .from('leads')
    .update({ escalated: true, escalation_reason: reason })
    .eq('phone', phone.replace(/[^0-9]/g, ''));

  await notifyMaddy(
    `ESCALATION: ${reason}`,
    `From ${masked}: "${(message || '').slice(0, 100)}"`
  );
}

function checkOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe';
}

module.exports = { needsEscalation, escalate, checkOptOut };
