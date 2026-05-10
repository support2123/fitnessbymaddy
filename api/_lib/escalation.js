const { sendTemplate } = require('./whatsapp');
const supabase = require('./supabase');
const { maskPhone } = require('./utils');

const MADDY_PHONE = '917082478374';

async function escalateToMaddy(reason, context) {
  const masked = context.phone ? maskPhone(context.phone) : 'unknown';
  const msg = `ESCALATION: ${reason}\nLead/Client: ${context.name || masked}\nPhone: ${context.phone || 'N/A'}\nDetails: ${context.details || 'None'}`;

  console.log(`Escalating to Maddy: ${reason} for ${masked}`);

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    context.name || masked,
    context.details || 'Review needed'
  ], true);

  await supabase.from('messages').insert({
    phone: MADDY_PHONE,
    direction: 'out',
    body: msg,
    template_name: 'escalation_alert',
    status: 'sent'
  });
}

async function checkMissedCheckins(clientId) {
  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const { data: checkins } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(3);

  if (!checkins) return;

  const weeksSinceStart = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const submittedWeeks = new Set(checkins.map(c => c.week_no));
  let consecutiveMissed = 0;
  for (let w = weeksSinceStart; w > Math.max(0, weeksSinceStart - 3); w--) {
    if (!submittedWeeks.has(w)) consecutiveMissed++;
    else break;
  }

  if (consecutiveMissed >= 2) {
    await escalateToMaddy('2 consecutive missed check-ins', {
      phone: client.phone,
      name: client.name,
      details: `${consecutiveMissed} weeks missed. Program: ${client.program}`
    });
  }
}

module.exports = { escalateToMaddy, checkMissedCheckins };
