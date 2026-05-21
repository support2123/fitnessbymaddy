const { supabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorex', 'bulimi', 'purge', 'not eating', 'starving'
];

function shouldEscalate(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function getEscalationReason(message) {
  const lower = (message || '').toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  return matched.join(', ');
}

async function escalate(phone, reason, messageBody, clientId) {
  await supabase.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody,
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    maskPhone(phone),
    reason,
    (messageBody || '').slice(0, 200),
  ]);
}

async function checkMissedCheckins(clientId, phone) {
  const { data: recent } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!recent || recent.length === 0) return;

  const { data: client } = await supabase
    .from('clients')
    .select('program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const lastCheckin = recent[0]?.week_no || 0;
  const missedWeeks = weeksElapsed - lastCheckin;

  if (missedWeeks >= 2) {
    await escalate(phone, '2 consecutive missed check-ins', null, clientId);
  }
}

module.exports = { shouldEscalate, getEscalationReason, escalate, checkMissedCheckins };
