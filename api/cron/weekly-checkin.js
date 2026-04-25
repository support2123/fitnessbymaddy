const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalate');
const { getCheckinUrl, weekNumber, isHinglish, detectMarket } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'] || '';
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const currentWeek = weekNumber(client.program_started_at);

      const { data: lastCheckin } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .single();

      const lastWeek = lastCheckin?.week_no || 0;

      if (lastWeek >= currentWeek) continue;

      const missedWeeks = currentWeek - lastWeek - 1;
      if (missedWeeks >= 2) {
        await escalateToMaddy(
          client.phone,
          `2 consecutive missed check-ins (last: week ${lastWeek}, current: week ${currentWeek})`,
          null,
          client.id
        );
        escalated++;
      }

      const url = getCheckinUrl(client.id, currentWeek);
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      await sendTemplate(client.phone,
        hinglish ? 'weekly_checkin' : 'weekly_checkin_en',
        [client.name || 'there', String(currentWeek), url]
      );
      sent++;

      scheduleNudges(client, currentWeek, url, market);
    }

    return res.status(200).json({
      message: `Weekly check-ins sent`,
      sent,
      escalated,
      total_clients: clients.length
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function scheduleNudges(client, weekNo, url, market) {
  const oneDay = 24 * 60 * 60 * 1000;
  const hinglish = isHinglish(market);

  setTimeout(async () => {
    const { data: checkin } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (!checkin) {
      await sendTemplate(client.phone,
        hinglish ? 'checkin_nudge_1' : 'checkin_nudge_1_en',
        [client.name || 'there', url]
      );
    }
  }, oneDay);

  setTimeout(async () => {
    const { data: checkin } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (!checkin) {
      await sendTemplate(client.phone,
        hinglish ? 'checkin_nudge_2' : 'checkin_nudge_2_en',
        [client.name || 'there', url]
      );
    }
  }, 2 * oneDay);
}
