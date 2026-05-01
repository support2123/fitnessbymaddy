const { getSupabase } = require('./supabase');
const { notifyMaddy, maskPhone } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'not eating',
];

function needsEscalation(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

async function createEscalation(phone, clientId, reason, messageBody) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody,
  });

  const masked = maskPhone(phone);
  await notifyMaddy(reason, `Phone: ${masked}\nMessage: ${messageBody || 'N/A'}`);
}

async function checkMissedCheckins(clientId) {
  const db = getSupabase();
  const { data: client } = await db
    .from('clients')
    .select('phone, name, program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const { data: checkins } = await db
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!checkins || checkins.length === 0) return;

  const weeksSinceStart = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const latestCheckin = checkins[0].week_no;
  const missedWeeks = weeksSinceStart - latestCheckin;

  if (missedWeeks >= 2) {
    await createEscalation(
      client.phone,
      clientId,
      '2 consecutive missed check-ins',
      `Client ${client.name || 'Unknown'} has missed ${missedWeeks} consecutive check-ins.`
    );
  }
}

module.exports = { needsEscalation, createEscalation, checkMissedCheckins };
