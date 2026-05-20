const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglishMarket, detectMarket } = require('../_lib/market');
const { maskPhone } = require('../_lib/mask');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isVercelCron && !isInternal && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    const errors = [];

    for (const client of activeClients) {
      try {
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
          .limit(1);

        if (existing && existing.length > 0) continue;

        const formUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const market = detectMarket(client.phone);
        const hinglish = isHinglishMarket(market);

        const msg = hinglish
          ? `Hey ${client.name || 'there'}! Week ${weekNo} check-in time. Apna progress fill karo: ${formUrl}`
          : `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in. Fill it out here: ${formUrl}`;

        await sendWhatsApp(client.phone, 'weekly_checkin', {
          text: msg,
          name: client.name || 'there',
          templateParams: [client.name || 'there', String(weekNo), formUrl],
          isClient: true,
          skipRateLimit: true
        });

        sent++;
      } catch (err) {
        errors.push({ client: maskPhone(client.phone), error: err.message });
      }
    }

    const { data: pendingNudges } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let nudged = 0;
    for (const client of (pendingNudges || [])) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      const prevWeek = weekNo - 1;
      if (prevWeek < 1) continue;

      const { data: prevCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', prevWeek)
        .limit(1);

      if (!prevCheckin || prevCheckin.length === 0) {
        const { data: prevPrevCheckin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', prevWeek - 1)
          .limit(1);

        if (!prevPrevCheckin || prevPrevCheckin.length === 0) {
          await supabase.from('escalations').insert({
            phone: client.phone,
            reason: '2 consecutive missed check-ins',
            message: `Client ${maskPhone(client.phone)} missed weeks ${prevWeek - 1} and ${prevWeek}`
          });
        }
      }
    }

    console.log(`[Cron] Weekly check-in: sent=${sent}, nudged=${nudged}, errors=${errors.length}`);
    return res.status(200).json({ sent, nudged, errors });
  } catch (err) {
    console.error('[Cron WeeklyCheckin] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
