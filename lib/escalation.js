const { supabase } = require('./supabase');
const { notifyMaddy } = require('./whatsapp');
const { maskPhone } = require('./helpers');

async function checkAndEscalate({ phone, name, message, reason }) {
  const masked = maskPhone(phone);
  const clientName = name || masked;

  const subject = `⚠️ ${reason}`;
  const details = `Client: ${clientName}\nPhone: ${masked}\nMessage: "${message || 'N/A'}"`;

  console.log(`ESCALATION: ${reason} for ${masked}`);
  await notifyMaddy(subject, details);
}

async function checkMissedCheckins(clientId) {
  const { data: client } = await supabase
    .from('clients')
    .select('phone, name')
    .eq('id', clientId)
    .single();

  const { data: checkins } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!client) return;

  const { data: latestProgram } = await supabase
    .from('programs')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(1);

  const currentWeek = latestProgram?.[0]?.week_no || 1;
  const checkedWeeks = (checkins || []).map(c => c.week_no);

  const missedConsecutive =
    !checkedWeeks.includes(currentWeek) &&
    !checkedWeeks.includes(currentWeek - 1);

  if (missedConsecutive) {
    await checkAndEscalate({
      phone: client.phone,
      name: client.name,
      reason: '2 consecutive missed check-ins'
    });
  }
}

module.exports = { checkAndEscalate, checkMissedCheckins };
