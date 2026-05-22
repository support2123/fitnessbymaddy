const { getSupabase } = require('./supabase');
const { notifyMaddy, maskPhone } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'not eating'
];

const MEDICAL_KEYWORDS = [
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'diabetes', 'thyroid', 'heart condition', 'blood pressure'
];

function checkEscalation(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return keyword;
    }
  }
  return null;
}

function checkMedical(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  for (const keyword of MEDICAL_KEYWORDS) {
    if (lower.includes(keyword)) {
      return keyword;
    }
  }
  return null;
}

async function createEscalation({ sourceType, sourceId, phone, reason, messageBody }) {
  const db = getSupabase();

  await db.from('escalations').insert({
    source_type: sourceType,
    source_id: sourceId,
    phone,
    reason,
    message_body: messageBody
  });

  await notifyMaddy(reason, `Phone: ${maskPhone(phone)}\nMessage: ${messageBody?.slice(0, 200) || 'N/A'}`);
}

module.exports = { checkEscalation, checkMedical, createEscalation };
