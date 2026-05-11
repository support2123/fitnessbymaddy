const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');
const { notifyMaddy, maskPhone } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  const { data: activeClients, error } = await supabase
    .from('clients')
    .select('*, leads!clients_lead_id_fkey(*)')
    .eq('status', 'active');

  if (error || !activeClients) {
    return res.status(500).json({ error: 'Failed to fetch clients' });
  }

  let sent = 0;
  let skipped = 0;
  const escalations = [];

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.ceil(daysSinceStart / 7);

    if (currentWeek < 1) {
      skipped++;
      continue;
    }

    const endDate = new Date(client.program_ends_at);
    if (now > endDate) {
      skipped++;
      continue;
    }

    const { data: existingCheckin } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', currentWeek)
      .single();

    if (existingCheckin) {
      skipped++;
      continue;
    }

    const { data: missedCheckins } = await supabase
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const submittedWeeks = missedCheckins ? missedCheckins.map(c => c.week_no) : [];
    let consecutiveMissed = 0;
    for (let w = currentWeek - 1; w >= 1 && consecutiveMissed < 2; w--) {
      if (!submittedWeeks.includes(w)) consecutiveMissed++;
      else break;
    }

    if (consecutiveMissed >= 2) {
      escalations.push(client);
    }

    const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
    const market = client.leads?.market || 'GLOBAL';

    const params = isHinglish(market)
      ? [client.name || 'there', `${currentWeek}`, checkinUrl]
      : [client.name || 'there', `${currentWeek}`, checkinUrl];

    await sendTemplate(client.phone, 'weekly_checkin', params, true);
    sent++;
  }

  for (const client of escalations) {
    await notifyMaddy(
      '2 consecutive missed check-ins',
      `Client: ${maskPhone(client.phone)} | ${client.name || 'Unknown'} | Program: ${client.program}`
    );
  }

  return res.status(200).json({
    action: 'weekly_checkin_sent',
    sent,
    skipped,
    escalations: escalations.length
  });
};
