const { getSupabase } = require('../lib/supabase');
const { sendTemplate, isHinglish, detectMarket } = require('../lib/whatsapp');
const { weekNumber } = require('../lib/helpers');

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
    return res.status(200).json({ message: 'No active clients' });
  }

  let sent = 0;
  let skipped = 0;

  for (const client of clients) {
    const wk = weekNumber(client.program_started_at);
    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', wk)
      .limit(1)
      .single();

    if (existing) {
      skipped++;
      continue;
    }

    const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${wk}`;

    await sendTemplate(client.phone, 'weekly_checkin', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        `${wk}`,
        checkinUrl
      ]
    });

    sent++;
  }

  return res.status(200).json({ sent, skipped, total: clients.length });
};
