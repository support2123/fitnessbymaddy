const { supabase } = require('../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    let sent = 0;
    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existingCheckin && existingCheckin.length > 0) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);

      const msg = market === 'IN'
        ? `Hey ${client.name || 'Champion'}! 📊 Week ${weekNo} check-in time. Apna progress share karo:\n\n${checkinUrl}\n\n5 min lagega — ye tumhare next week ka plan decide karega!`
        : `Hey ${client.name || 'Champion'}! 📊 Time for your Week ${weekNo} check-in:\n\n${checkinUrl}\n\nTakes 5 min — this shapes your next week's plan!`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        body: msg,
        params: [client.name || 'Champion', String(weekNo), checkinUrl]
      });

      sent++;
    }

    return res.status(200).json({ success: true, sent });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
