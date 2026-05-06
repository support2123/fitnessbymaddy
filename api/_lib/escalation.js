const { getSupabase } = require('./supabase');
const { sendTemplate, BUSINESS_PHONE } = require('./whatsapp');
const { maskPhone } = require('./helpers');

const MADDY_PHONE = BUSINESS_PHONE;

async function escalate(phone, reason, triggerMessage, clientId) {
  const supabase = getSupabase();

  await supabase.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    trigger_message: triggerMessage?.slice(0, 2000),
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    maskPhone(phone),
    (triggerMessage || '').slice(0, 200),
  ]);

  console.log(`[ESCALATION] ${reason} for ${maskPhone(phone)}`);
}

async function checkConsecutiveMissed(clientId) {
  const supabase = getSupabase();
  const { data: client } = await supabase
    .from('clients')
    .select('phone, name')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const { data: checkins } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: latestProgram } = await supabase
    .from('programs')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(1);

  if (!latestProgram?.length) return;

  const currentWeek = latestProgram[0].week_no;
  const submittedWeeks = (checkins || []).map(c => c.week_no);

  const missed = [currentWeek, currentWeek - 1].filter(w => !submittedWeeks.includes(w));

  if (missed.length >= 2) {
    await escalate(
      client.phone,
      '2 consecutive missed check-ins',
      `Client ${client.name || maskPhone(client.phone)} missed weeks ${missed.join(', ')}`,
      clientId
    );
  }
}

module.exports = { escalate, checkConsecutiveMissed };
