const { getSupabase } = require('./supabase');
const { sendTemplate, maskPhone } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'bulimia', 'anorexia', 'not eating', 'medical'
];

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

function needsEscalation(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

async function createEscalation(phone, reason, messageBody) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', {
    templateParams: [
      maskPhone(phone),
      reason,
      (messageBody || '').slice(0, 200)
    ]
  });
}

module.exports = { needsEscalation, createEscalation, ESCALATION_KEYWORDS };
