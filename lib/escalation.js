const { getSupabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./utils');

const MADDY_PHONE = '917082478374';

async function escalateToMaddy(phone, reason, messageBody) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody,
    resolved: false,
  });

  const masked = maskPhone(phone);
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    masked,
    (messageBody || '').slice(0, 200),
  ]);

  console.log(`[ESCALATION] ${reason} from ${masked}`);
}

async function checkMissedCheckins(clientId) {
  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('phone, name, program')
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

  const latestWeek = checkins[0].week_no;
  const { data: programs } = await db
    .from('programs')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(1);

  if (programs && programs.length > 0) {
    const expectedWeek = programs[0].week_no;
    const missedCount = expectedWeek - latestWeek;
    if (missedCount >= 2) {
      await escalateToMaddy(
        client.phone,
        '2 consecutive missed check-ins',
        `${client.name} on ${client.program} has missed ${missedCount} check-ins.`
      );
    }
  }
}

module.exports = { escalateToMaddy, checkMissedCheckins };
