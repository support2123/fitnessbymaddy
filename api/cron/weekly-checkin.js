const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, sendText } = require('../_lib/whatsapp');
const { isHinglishMarket, maskPhone } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { sent: 0, skipped: 0, errors: 0 };

  try {
    const { data: clients } = await db
      .from('clients')
      .select('*, leads!inner(market)')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', ...results });
    }

    for (const client of clients) {
      try {
        const { data: checkins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1);

        const lastWeek = checkins && checkins.length > 0 ? checkins[0].week_no : 0;
        const nextWeek = lastWeek + 1;

        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const expectedWeek = Math.ceil(daysSinceStart / 7);

        if (nextWeek > expectedWeek + 1) {
          results.skipped++;
          continue;
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${nextWeek}`;
        const market = client.leads ? client.leads.market : 'GLOBAL';
        const hinglish = isHinglishMarket(market);

        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(nextWeek),
          checkinUrl
        ]);

        results.sent++;
      } catch (err) {
        console.error(`Check-in send failed for ${maskPhone(client.phone)}:`, err.message);
        results.errors++;
      }
    }

    return res.status(200).json({ message: 'Weekly check-ins processed', ...results });

  } catch (err) {
    console.error('Cron weekly-checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
