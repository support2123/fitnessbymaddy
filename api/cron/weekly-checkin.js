const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isVercelCron && !isInternal && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { sent: 0, skipped: 0, errors: 0 };

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', results });
    }

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) {
          results.skipped++;
          continue;
        }

        if (client.program_ends_at && now > new Date(client.program_ends_at)) {
          await db.from('clients').update({ status: 'completed' }).eq('id', client.id);
          results.skipped++;
          continue;
        }

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (existing) {
          results.skipped++;
          continue;
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
        const hinglish = isHinglish(client.market || 'GLOBAL');

        // Detect market from phone if not stored
        let market = 'GLOBAL';
        if (client.phone) {
          const { detectMarket } = require('../../lib/market');
          market = detectMarket(client.phone);
        }

        if (isHinglish(market)) {
          await sendTemplate(client.phone, 'weekly_checkin', [
            client.name || 'there',
            `Week ${currentWeek} ka check-in time! Apna progress update karo:`,
            checkinUrl
          ]);
        } else {
          await sendTemplate(client.phone, 'weekly_checkin', [
            client.name || 'there',
            `Time for your Week ${currentWeek} check-in! Update your progress:`,
            checkinUrl
          ]);
        }

        results.sent++;
      } catch (clientErr) {
        console.error(`Checkin send error for client ${client.id}:`, clientErr.message);
        results.errors++;
      }
    }

    return res.status(200).json({ ok: true, results });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
