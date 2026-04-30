const { getSupabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia',
  'bulimia', 'vomit', 'faint',
];

function needsEscalation(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

async function createEscalation(phone, reason, messageBody) {
  const db = getSupabase();
  await db.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody?.substring(0, 1000),
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    phone.substring(phone.length - 4),
  ]);
}

function isOptOut(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

module.exports = { needsEscalation, createEscalation, isOptOut, ESCALATION_KEYWORDS };
