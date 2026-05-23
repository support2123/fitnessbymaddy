const { getSupabase } = require('./supabase');
const { sendWhatsApp, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'not eating',
  'medical condition', 'surgery', 'doctor said'
];

function needsEscalation(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

async function createEscalation(sourceType, sourceId, phone, reason, details) {
  const db = getSupabase();

  await db.from('escalations').insert({
    source_type: sourceType,
    source_id: sourceId,
    phone,
    reason,
    details
  });

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [
      reason,
      maskPhone(phone),
      (details || '').slice(0, 200)
    ]
  });
}

module.exports = { needsEscalation, createEscalation };
