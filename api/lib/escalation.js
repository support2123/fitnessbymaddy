const { getSupabase } = require('./supabase');
const { sendText } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex',
  'bulimi', 'not eating', 'faint', 'hospital'
];

function needsEscalation(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

async function escalate(phone, reason, messageBody, clientId) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody
  });

  const alertText = `ESCALATION ALERT\nPhone: ${phone}\nReason: ${reason}\nMessage: "${messageBody?.slice(0, 200)}"`;
  await sendText(MADDY_PHONE, alertText);

  return true;
}

async function checkMissedCheckins(clientId) {
  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksActive = Math.ceil(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const { count } = await db
    .from('checkins')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('week_no', weeksActive - 1);

  if (count === 0 && weeksActive >= 2) {
    await escalate(
      client.phone,
      '2 consecutive missed check-ins',
      `Client ${client.name || client.phone} has missed 2+ check-ins`,
      clientId
    );
  }
}

module.exports = { needsEscalation, escalate, checkMissedCheckins, ESCALATION_KEYWORDS };
