const { getSupabase } = require('./supabase');
const { sendTemplate, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulim',
  'not eating', 'throwing up', 'vomit'
];

function needsEscalation(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

async function createEscalation(phone, reason, messageBody, clientId) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    maskPhone(phone),
    reason,
    (messageBody || '').slice(0, 200)
  ]);
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

  const { data: recentCheckins } = await db
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!recentCheckins || recentCheckins.length < 2) return;

  const weekDiff = recentCheckins[0].week_no - recentCheckins[1].week_no;
  if (weekDiff > 2) {
    await createEscalation(
      client.phone,
      '2 consecutive missed check-ins',
      `Client ${client.name || 'unknown'} has missed 2+ consecutive check-ins`,
      clientId
    );
  }
}

module.exports = { needsEscalation, createEscalation, checkMissedCheckins };
