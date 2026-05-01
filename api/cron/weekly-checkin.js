const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { escalateToMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const { data: clients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!clients || clients.length === 0) {
    return res.json({ ok: true, message: 'No active clients', sent: 0 });
  }

  let sent = 0;
  let escalated = 0;

  for (const client of clients) {
    const startDate = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.ceil(daysSinceStart / 7);

    if (currentWeek < 1) continue;

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', currentWeek)
      .maybeSingle();

    if (existing) continue;

    const { data: missedCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
    const lastTwoExpected = [currentWeek - 1, currentWeek - 2].filter(w => w > 0);
    const missedCount = lastTwoExpected.filter(w => !submittedWeeks.includes(w)).length;

    if (missedCount >= 2) {
      await escalateToMaddy(
        '2 consecutive missed check-ins',
        client.phone,
        `${client.name || 'Client'} (${client.program}) — missed weeks ${lastTwoExpected.join(', ')}`
      );
      escalated++;
    }

    const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
    await sendTemplate(client.phone, 'weekly_checkin', [
      client.name || 'there',
      String(currentWeek),
      checkinUrl,
    ]);
    sent++;
  }

  return res.json({ ok: true, sent, escalated, total_clients: clients.length });
};
