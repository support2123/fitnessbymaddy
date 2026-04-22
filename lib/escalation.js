const { notifyMaddy } = require('./whatsapp');
const { maskPhone } = require('./helpers');

async function escalate(reason, phone, extraContext = '') {
  const masked = maskPhone(phone);
  const details = `Phone: ${masked}\nReason: ${reason}${extraContext ? '\nContext: ' + extraContext : ''}`;
  console.log(`[Escalation] ${reason} for ${masked}`);
  return notifyMaddy(`Escalation: ${reason}`, details);
}

async function checkMissedCheckins(supabase) {
  const { data: clients } = await supabase
    .from('clients')
    .select('id, phone, name, program_started_at')
    .eq('status', 'active');

  if (!clients) return [];

  const escalated = [];

  for (const client of clients) {
    const { data: checkins } = await supabase
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    if (!checkins) continue;

    const weeksSinceStart = Math.floor(
      (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
    );

    const completedWeeks = checkins.map(c => c.week_no);
    let consecutive = 0;
    for (let w = weeksSinceStart; w > Math.max(0, weeksSinceStart - 3); w--) {
      if (!completedWeeks.includes(w)) consecutive++;
      else break;
    }

    if (consecutive >= 2) {
      await escalate(
        '2 consecutive missed check-ins',
        client.phone,
        `Client: ${client.name || 'Unknown'}, missed weeks at week ${weeksSinceStart}`
      );
      escalated.push(client.id);
    }
  }

  return escalated;
}

module.exports = { escalate, checkMissedCheckins };
