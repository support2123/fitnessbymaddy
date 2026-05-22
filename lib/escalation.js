const { getSupabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'not eating',
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout'];

function checkEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.find(kw => lower.includes(kw)) || null;
}

function checkOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(kw => lower === kw || lower.startsWith(kw));
}

async function escalateToMaddy(phone, triggerKeyword, messageBody, clientId) {
  const sb = getSupabase();

  await sb.from('escalations').insert({
    phone,
    client_id: clientId || null,
    trigger_keyword: triggerKeyword,
    message_body: messageBody?.slice(0, 1000),
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [
      maskPhone(phone),
      triggerKeyword,
      (messageBody || '').slice(0, 200),
    ],
  });
}

async function handleOptOut(phone) {
  const sb = getSupabase();
  await sb
    .from('leads')
    .update({ status: 'dropped' })
    .eq('phone', phone);

  await sb
    .from('clients')
    .update({ status: 'paused' })
    .eq('phone', phone);
}

async function checkMissedCheckins(clientId) {
  const sb = getSupabase();
  const { data: client } = await sb
    .from('clients')
    .select('phone, name, program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const { data: checkins } = await sb
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  const checkedWeeks = (checkins || []).map(c => c.week_no);
  let consecutiveMissed = 0;
  for (let w = weeksElapsed; w > Math.max(0, weeksElapsed - 2); w--) {
    if (!checkedWeeks.includes(w)) consecutiveMissed++;
  }

  if (consecutiveMissed >= 2) {
    await escalateToMaddy(
      client.phone,
      '2_consecutive_missed_checkins',
      `Client ${client.name || maskPhone(client.phone)} missed ${consecutiveMissed} consecutive check-ins`,
      clientId
    );
  }
}

module.exports = {
  checkEscalation,
  checkOptOut,
  escalateToMaddy,
  handleOptOut,
  checkMissedCheckins,
};
