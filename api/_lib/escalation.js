const { getSupabase } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'medical condition', 'surgery', 'heart', 'diabetes'
];

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

function needsEscalation(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

async function escalate(phone, reason, messageBody) {
  const db = getSupabase();
  await db.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody
  });

  await sendWhatsApp(MADDY_PHONE, null,
    `ESCALATION ALERT\nFrom: ${phone}\nReason: ${reason}\nMessage: "${(messageBody || '').slice(0, 200)}"`
  );
}

module.exports = { needsEscalation, escalate, ESCALATION_KEYWORDS };
