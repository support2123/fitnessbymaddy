const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { data: activeClients } = await db.from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.json({ action: 'no_active_clients' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) {
        skipped++;
        continue;
      }

      const { data: existing } = await db.from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) {
        skipped++;
        continue;
      }

      const { data: prevCheckins } = await db.from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const missedWeeks = prevCheckins
        ? Array.from({ length: 2 }, (_, i) => weekNo - 1 - i)
            .filter(w => w > 0 && !prevCheckins.some(c => c.week_no === w))
        : [];

      if (missedWeeks.length >= 2) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: client.phone,
          name: client.name,
          message: `Client has missed weeks ${missedWeeks.join(', ')}`,
        });
      }

      const checkinLink = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      await sendWhatsApp(client.phone, 'weekly_checkin', [
        client.name || 'there',
        `${weekNo}`,
        checkinLink,
      ]);

      sent++;
    }

    return res.json({ action: 'checkins_sent', sent, skipped, total: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
