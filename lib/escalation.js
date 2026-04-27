const { getClient } = require('./supabase');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'purging', 'not eating', 'faint', 'chest pain',
  'heart', 'surgery', 'hospital'
];

function needsEscalation(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

async function createEscalation(phone, reason, triggerMessage, clientId) {
  const db = getClient();
  await db.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    trigger_message: triggerMessage,
  });
}

async function notifyMaddy(phone, reason, sendWhatsApp) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  const body = `ESCALATION\nFrom: ${phone}\nReason: ${reason}\nPlease review in the admin dashboard.`;
  await sendWhatsApp(maddyPhone, body);
}

module.exports = { needsEscalation, createEscalation, notifyMaddy };
