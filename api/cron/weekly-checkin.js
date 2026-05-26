const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, sendText } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { notifyMaddy } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const { data: clients, error } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active')
    .not('program', 'is', null);

  if (error || !clients) {
    console.error('Failed to fetch active clients:', error);
    return res.status(500).json({ error: 'DB query failed' });
  }

  let sent = 0;
  let skipped = 0;
  const errors = [];

  for (const client of clients) {
    try {
      const { data: lastCheckin } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .single();

      const nextWeek = lastCheckin ? lastCheckin.week_no + 1 : 1;

      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const maxWeek = Math.ceil(daysSinceStart / 7);

      if (nextWeek > maxWeek + 1) {
        skipped++;
        continue;
      }

      const { count: missedCount } = await db
        .from('checkins')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', nextWeek - 2);

      if (lastCheckin && nextWeek - lastCheckin.week_no >= 3) {
        await notifyMaddy(
          `2+ consecutive missed check-ins: ${maskPhone(client.phone)}`,
          `Client: ${client.name}\nProgram: ${client.program}\nLast check-in: Week ${lastCheckin.week_no}`
        );
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${nextWeek}`;
      const market = client.market || 'IN';

      await sendTemplate(client.phone, 'weekly_checkin', {
        name: client.name || 'there',
        templateParams: [client.name || 'there', String(nextWeek), checkinUrl]
      });

      sent++;
    } catch (err) {
      errors.push({ client_id: client.id, error: err.message });
    }
  }

  return res.status(200).json({
    ok: true,
    total_clients: clients.length,
    sent,
    skipped,
    errors: errors.length,
    error_details: errors.slice(0, 5)
  });
};
