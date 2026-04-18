const supabase = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglishMarket, detectMarket } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ status: 'no_active_clients' });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: lastCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const missedWeeks = lastCheckins
        ? currentWeek - 1 - (lastCheckins[0] ? lastCheckins[0].week_no : 0)
        : currentWeek - 1;

      if (missedWeeks >= 2) {
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          client.phone,
          client.name + ' has missed ' + missedWeeks + ' check-ins (Week ' + currentWeek + ')'
        );
        escalated++;
      }

      const checkinUrl = 'https://fitnessbymaddy.com/checkin.html?c=' + client.id + '&w=' + currentWeek;
      const market = detectMarket(client.phone);
      const template = isHinglishMarket(market) ? 'weekly_checkin' : 'weekly_checkin_en';

      await sendTemplate(client.phone, template, [
        client.name || 'there',
        String(currentWeek),
        checkinUrl
      ], client.name || '');

      sent++;
    }

    return res.status(200).json({ status: 'done', sent, escalated, total: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
