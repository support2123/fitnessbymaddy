const { supabase } = require('./supabase');
const { sendTemplate, maskPhone } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

async function escalate(phone, reason, messageBody) {
  await supabase.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody,
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    maskPhone(phone),
    (messageBody || '').slice(0, 100),
  ]);
}

async function checkMissedCheckins(clientId, phone) {
  const { data } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!data || data.length === 0) return;

  const { data: client } = await supabase
    .from('clients')
    .select('program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const currentWeek = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) /
      (7 * 24 * 60 * 60 * 1000)
  ) + 1;

  const latestCheckin = data[0]?.week_no || 0;
  if (currentWeek - latestCheckin >= 2) {
    await escalate(phone, '2 consecutive missed check-ins', `Client missed weeks ${latestCheckin + 1} and ${currentWeek}`);
  }
}

module.exports = { escalate, checkMissedCheckins };
