const { getSupabase } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'not eating',
];

function needsEscalation(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

async function escalateToMaddy(phone, triggerType, messageBody) {
  const supabase = getSupabase();

  await supabase.from('escalations').insert({
    phone,
    trigger_type: triggerType,
    message_body: messageBody,
  });

  const masked = phone.substring(0, 4) + 'XXX...' + phone.slice(-3);
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
    triggerType,
    masked,
    (messageBody || '').substring(0, 200),
  ]);
}

async function checkMissedCheckins(clientId) {
  const supabase = getSupabase();
  const { data: client } = await supabase
    .from('clients')
    .select('phone, name, program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const { data: checkins } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!checkins) return;
  const lastWeek = checkins[0]?.week_no || 0;
  if (weeksElapsed - lastWeek >= 2) {
    await escalateToMaddy(
      client.phone,
      '2_missed_checkins',
      `${client.name || 'Client'} has missed 2+ consecutive check-ins (last: week ${lastWeek}, current: week ${weeksElapsed})`
    );
  }
}

module.exports = { needsEscalation, escalateToMaddy, checkMissedCheckins };
