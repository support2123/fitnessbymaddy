const { getSupabase } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'chest pain',
  'eating disorder', 'anorexia', 'bulimia', 'purge', 'binge',
  'not eating', 'starving myself',
];

function needsEscalation(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

async function createEscalation(sourceType, sourceId, phone, reason) {
  const db = getSupabase();

  await db.from('escalations').insert({
    source_type: sourceType,
    source_id: sourceId,
    phone,
    reason,
  });

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
    reason,
    phone ? phone.slice(-4) : '???',
  ]);
}

module.exports = { needsEscalation, createEscalation, ESCALATION_KEYWORDS };
