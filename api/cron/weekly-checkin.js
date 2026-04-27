const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { sent: 0, nudged: 0, escalated: 0, errors: 0 };

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
        const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (86400000));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) continue;

        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .limit(1);

        if (existingCheckin && existingCheckin.length > 0) continue;

        const { data: lastTwoCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(2);

        if (lastTwoCheckins && lastTwoCheckins.length >= 1) {
          const lastWeek = lastTwoCheckins[0].week_no;
          const missedWeeks = currentWeek - lastWeek - 1;

          if (missedWeeks >= 2) {
            await escalateToMaddy(
              '2 consecutive missed check-ins',
              client.phone,
              `${client.name || 'Client'} missed weeks ${lastWeek + 1}-${currentWeek - 1}`
            );
            results.escalated++;
          }
        }

        const market = detectMarket(client.phone);
        const template = isHinglish(market) ? 'weekly_checkin_hi' : 'weekly_checkin';
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

        await sendWhatsApp(client.phone, template, [
          client.name || 'there',
          `${currentWeek}`,
          checkinUrl,
        ]);

        results.sent++;
      } catch (clientErr) {
        console.error(`Checkin error for client ${client.id}:`, clientErr.message);
        results.errors++;
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
