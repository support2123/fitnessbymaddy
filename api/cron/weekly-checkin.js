const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { notifyMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const { data: activeClients } = await db.from('clients')
    .select('*')
    .eq('status', 'active');

  if (!activeClients || activeClients.length === 0) {
    return res.status(200).json({ ok: true, processed: 0 });
  }

  let sent = 0;
  let escalated = 0;

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.ceil(daysSinceStart / 7);

    if (currentWeek < 1) continue;

    const endDate = client.program_ends_at ? new Date(client.program_ends_at) : null;
    if (endDate && now > endDate) continue;

    const { data: existingCheckin } = await db.from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', currentWeek)
      .single();

    if (existingCheckin) continue;

    const { data: missedCheckins } = await db.from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
    let consecutiveMissed = 0;
    for (let w = currentWeek - 1; w >= 1 && consecutiveMissed < 3; w--) {
      if (!submittedWeeks.includes(w)) consecutiveMissed++;
      else break;
    }

    if (consecutiveMissed >= 2) {
      await notifyMaddy(
        '2+ consecutive missed check-ins',
        client.phone,
        `${client.name || 'Client'} — ${consecutiveMissed} missed, current week ${currentWeek}`
      );
      escalated++;
    }

    const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

    await sendTemplate(client.phone, 'weekly_checkin', [
      client.name || 'there',
      String(currentWeek),
      checkinUrl
    ]);

    sent++;
  }

  return res.status(200).json({ ok: true, sent, escalated, total: activeClients.length });
};
