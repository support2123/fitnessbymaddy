const { supabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./utils');

const MADDY_PHONE = '+917082478374';

async function escalate(phone, reason, messageBody) {
  console.log(`[ESCALATION] ${reason} from ${maskPhone(phone)}`);

  await supabase.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody,
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    maskPhone(phone),
    (messageBody || '').slice(0, 200),
  ]);

  return { escalated: true };
}

async function checkMissedCheckins(clientId) {
  const { data: checkins } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: client } = await supabase
    .from('clients')
    .select('phone, program_started_at')
    .eq('id', clientId)
    .single();

  if (!client || !client.program_started_at) return false;

  const weeksActive = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const submittedWeeks = (checkins || []).map(c => c.week_no);
  let consecutiveMissed = 0;

  for (let w = weeksActive; w > 0 && consecutiveMissed < 2; w--) {
    if (!submittedWeeks.includes(w)) consecutiveMissed++;
    else break;
  }

  if (consecutiveMissed >= 2) {
    await escalate(client.phone, '2 consecutive missed check-ins', `Client ${clientId} missed ${consecutiveMissed} check-ins`);
    return true;
  }

  return false;
}

module.exports = { escalate, checkMissedCheckins };
