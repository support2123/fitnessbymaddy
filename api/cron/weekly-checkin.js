const { supabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../_lib/market');
const { escalate } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;
  if (!isVercelCron && !isInternal && req.method !== 'GET') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ ok: true, processed: 0 });
    }

    let sent = 0;
    let nudged = 0;
    let escalated = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: lastCheckin } = await supabase
        .from('checkins')
        .select('week_no, form_submitted_at')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastCheckinWeek = lastCheckin ? lastCheckin.week_no : 0;

      if (lastCheckinWeek >= currentWeek) continue;

      const missedWeeks = currentWeek - lastCheckinWeek - 1;

      if (missedWeeks >= 2) {
        await escalate(
          client.phone,
          '2_consecutive_missed_checkins',
          `${client.name || 'Client'} missed ${missedWeeks} consecutive check-ins`
        );
        escalated++;
      }

      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);
      const formUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'Champion',
        `Week ${currentWeek}`,
        formUrl
      ]);

      sent++;
      console.log(`Checkin sent: ${maskPhone(client.phone)} week ${currentWeek}`);
    }

    return res.status(200).json({ ok: true, sent, nudged, escalated, total: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
