const { supabase } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'vomit', 'faint', 'chest pain', 'heart'
];

function needsEscalation(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

async function escalate(phone, reason, messageBody) {
  await supabase.from('escalations').insert({
    phone,
    trigger_reason: reason,
    message_body: messageBody
  });

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
    reason,
    phone.slice(0, 4) + 'XXX...' + phone.slice(-3),
    (messageBody || '').slice(0, 200)
  ]);
}

async function checkMissedCheckins(clientId) {
  const { count } = await supabase
    .from('checkins')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  return (count || 0) === 0;
}

module.exports = { needsEscalation, escalate, checkMissedCheckins };
