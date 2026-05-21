const { getSupabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'bulimi', 'anorexi', 'not eating', 'purging'
];

function needsEscalation(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

function isOptOut(messageText) {
  if (!messageText) return false;
  const lower = messageText.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

async function escalate(phone, reason, message) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    reason,
    message
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    maskPhone(phone),
    (message || '').slice(0, 200)
  ]);

  console.log(`Escalation: ${reason} for ${maskPhone(phone)}`);
}

async function checkMissedCheckins(clientId) {
  const db = getSupabase();
  const { data: client } = await db
    .from('clients')
    .select('phone, name')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const { count } = await db
    .from('checkins')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: latestWeeks } = await db
    .from('programs')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(1);

  if (!latestWeeks || latestWeeks.length === 0) return;

  const currentWeek = latestWeeks[0].week_no;
  const { data: recentCheckins } = await db
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .gte('week_no', currentWeek - 1);

  if (!recentCheckins || recentCheckins.length === 0) {
    await escalate(
      client.phone,
      '2 consecutive missed check-ins',
      `Client ${client.name || maskPhone(client.phone)} has missed the last 2 check-ins.`
    );
  }
}

module.exports = { needsEscalation, isOptOut, escalate, checkMissedCheckins, MADDY_PHONE };
