const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients, error } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('[Cron:Checkin] DB error:', error.message);
      return res.status(500).json({ error: 'DB error' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of activeClients || []) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) { skipped++; continue; }

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existing) { skipped++; continue; }

      const { data: lastTwo } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      if (lastTwo && lastTwo.length === 0 && currentWeek > 2) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name || maskPhone(client.phone)}\nProgram: ${client.program}\nCurrent week: ${currentWeek}`
        );
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        bodyValues: [
          client.name || 'there',
          String(currentWeek),
          checkinUrl,
        ],
      });

      sent++;
    }

    console.log(`[Cron:Checkin] Sent: ${sent}, Skipped: ${skipped}`);
    return res.status(200).json({ ok: true, sent, skipped });
  } catch (err) {
    console.error('[Cron:Checkin] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
