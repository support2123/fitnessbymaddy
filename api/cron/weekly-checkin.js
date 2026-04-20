const { supabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { isHinglish, detectMarket } = require('../_lib/market');
const { escalateToMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at, market:leads(market)')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const { count: missedCount } = await supabase
        .from('checkins')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', weekNo - 2);

      const expectedCheckins = Math.min(weekNo, 2);
      if (expectedCheckins - (missedCount || 0) >= 2) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: client.phone,
          body: `Client ${client.name || client.id} has missed 2+ consecutive check-ins`,
        });
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = client.market?.[0]?.market || detectMarket(client.phone);
      const hinglish = isHinglish(market);

      const params = hinglish
        ? [client.name || 'there', `Week ${weekNo} ka check-in time! 📋 Yeh form fill karo: ${checkinUrl}`]
        : [client.name || 'there', `Time for your Week ${weekNo} check-in! 📋 Fill out the form: ${checkinUrl}`];

      await sendTemplate(client.phone, 'weekly_checkin', params);
      sent++;
    }

    return res.status(200).json({ ok: true, sent, escalated, total: clients.length });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
