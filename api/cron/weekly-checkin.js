const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'] || '';
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, processed: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .limit(1);

      if (existingCheckin && existingCheckin.length > 0) continue;

      const { count: missedCount } = await db
        .from('checkins')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', currentWeek - 2);

      const expectedCheckins = Math.min(currentWeek, 2);
      const actualCheckins = missedCount || 0;

      if (expectedCheckins - actualCheckins >= 2) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: maskPhone(client.phone),
          message: `${client.name} has missed 2+ consecutive check-ins (Week ${currentWeek})`,
        });
        escalated++;
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

      await sendWhatsApp(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(currentWeek),
        checkinUrl,
      ]);

      sent++;
    }

    return res.status(200).json({ ok: true, sent, escalated, total: activeClients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
