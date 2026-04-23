const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp, maskPhone } = require('../_lib/whatsapp');
const { weekNumber } = require('../_lib/utils');
const { notifyMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const db = getSupabase();

  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!activeClients || activeClients.length === 0) {
    return res.status(200).json({ action: 'no_active_clients' });
  }

  const results = { sent: 0, skipped: 0, escalated: 0 };

  for (const client of activeClients) {
    const wk = weekNumber(client.program_started_at);

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', wk)
      .single();

    if (existing) {
      results.skipped++;
      continue;
    }

    const { data: missedWeeks } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const lastCheckinWeek = missedWeeks && missedWeeks.length > 0
      ? missedWeeks[0].week_no
      : 0;
    const consecutiveMissed = wk - lastCheckinWeek - 1;

    if (consecutiveMissed >= 2) {
      await notifyMaddy({
        phone: client.phone,
        reason: `${consecutiveMissed} consecutive missed check-ins`,
        message: `Client ${client.name || maskPhone(client.phone)} hasn't checked in for ${consecutiveMissed} weeks`,
        type: 'Missed check-ins',
      });
      results.escalated++;
    }

    const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${wk}`;
    await sendWhatsApp(client.phone, 'weekly_checkin', [
      client.name || 'there',
      String(wk),
      checkinUrl,
    ]);

    results.sent++;
  }

  return res.status(200).json({ action: 'weekly_checkin_sent', ...results });
};
