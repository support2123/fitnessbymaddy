const { getSupabase } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./utils');

const MADDY_PHONE = '+917082478374';

async function escalateToMaddy(phone, reason, messageBody, clientId) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody
  });

  const masked = maskPhone(phone);
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [reason, masked],
    body: `ESCALATION: ${reason} from ${masked}`
  });
}

async function checkMissedCheckins(clientId) {
  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('phone, program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const { data: checkins } = await db
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(3);

  if (!checkins) return;

  const weekNos = checkins.map(c => c.week_no);
  const start = new Date(client.program_started_at);
  const currentWeek = Math.ceil((Date.now() - start) / (7 * 24 * 60 * 60 * 1000));

  let consecutiveMissed = 0;
  for (let w = currentWeek; w > Math.max(0, currentWeek - 3); w--) {
    if (!weekNos.includes(w)) consecutiveMissed++;
    else break;
  }

  if (consecutiveMissed >= 2) {
    await escalateToMaddy(
      client.phone,
      '2 consecutive missed check-ins',
      `Client has missed ${consecutiveMissed} consecutive check-ins`,
      clientId
    );
  }
}

module.exports = { escalateToMaddy, checkMissedCheckins };
