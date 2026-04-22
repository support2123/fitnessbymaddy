const { supabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./helpers');

const MADDY_PHONE = '917082478374';

async function escalate(phone, reason, messageBody) {
  console.log(`ESCALATION [${maskPhone(phone)}]: ${reason}`);

  await supabase.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody ? messageBody.slice(0, 2000) : null
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    maskPhone(phone),
    reason,
    (messageBody || '').slice(0, 200)
  ], 'Maddy');
}

async function checkMissedCheckins(clientId, phone) {
  const { data: recent } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(3);

  if (!recent || recent.length === 0) return;

  const { data: client } = await supabase
    .from('clients')
    .select('program_started_at, program')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const startDate = new Date(client.program_started_at);
  const now = new Date();
  const weeksElapsed = Math.floor((now - startDate) / (7 * 24 * 60 * 60 * 1000));
  const submittedWeeks = recent.map(c => c.week_no);

  let consecutiveMissed = 0;
  for (let w = weeksElapsed; w > 0 && consecutiveMissed < 2; w--) {
    if (!submittedWeeks.includes(w)) {
      consecutiveMissed++;
    } else {
      break;
    }
  }

  if (consecutiveMissed >= 2) {
    await escalate(phone, '2 consecutive missed check-ins', `Client has missed ${consecutiveMissed} check-ins in a row`);
  }
}

module.exports = { escalate, checkMissedCheckins };
