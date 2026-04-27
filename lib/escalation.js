const { getSupabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
  'medical', 'surgery', 'hospital', 'doctor said',
];

function needsEscalation(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

async function createEscalation(phone, reason, messageBody, clientId) {
  const sb = getSupabase();

  await sb.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody?.slice(0, 2000),
  });

  const maddyPhone = process.env.MADDY_PHONE;
  if (maddyPhone) {
    await sendTemplate(maddyPhone, 'escalation_alert', {
      name: 'Maddy',
      templateParams: [reason, phone.slice(-4)],
    });
  }
}

module.exports = { needsEscalation, createEscalation };
