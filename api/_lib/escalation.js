const { getSupabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia',
  'bulimia', 'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
];

function findEscalationReason(messageBody) {
  const lower = messageBody.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

async function checkEscalation(phone, messageBody, clientId) {
  const reason = findEscalationReason(messageBody);
  if (!reason) return { escalated: false, reason: null };

  const supabase = getSupabase();

  await supabase.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody,
  });

  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  try {
    await sendTemplate(maddyPhone, 'escalation_alert', [phone, reason]);
  } catch (err) {
    console.error('Failed to notify Maddy about escalation:', err.message);
  }

  return { escalated: true, reason };
}

module.exports = { checkEscalation };
