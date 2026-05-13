const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients?.length) {
      return res.status(200).json({ message: 'No active clients' });
    }

    let sent = 0;
    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / 86400000);
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = client.market || 'IN';

      const params = isHinglish(market)
        ? [`Week ${weekNo} ka check-in time! Apna progress share karo:\n${checkinUrl}`]
        : [`Time for your Week ${weekNo} check-in! Share your progress:\n${checkinUrl}`];

      await sendWhatsApp(client.phone, 'weekly_checkin', params);
      sent++;
    }

    return res.status(200).json({ sent });
  } catch (err) {
    console.error('[cron/weekly-checkin]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
