const { getSupabase } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./market');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'not eating',
  'medical condition', 'surgery', 'doctor said'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function createEscalation({ sourceType, sourceId, phone, reason, details }) {
  const db = getSupabase();

  await db.from('escalations').insert({
    source_type: sourceType,
    source_id: sourceId,
    phone,
    reason,
    details
  });

  const maddyPhone = process.env.MADDY_PHONE;
  if (maddyPhone) {
    await sendWhatsApp({
      phone: maddyPhone,
      body: `ESCALATION [${reason}]\nFrom: ${maskPhone(phone)}\n${details || ''}`.slice(0, 1000),
      isClient: true
    });
  }
}

module.exports = { needsEscalation, createEscalation, ESCALATION_KEYWORDS };
