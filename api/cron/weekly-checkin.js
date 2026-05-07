const { supabase } = require('../_lib/supabase');
const { sendTemplate, maskPhone } = require('../_lib/whatsapp');
const { detectMarket, getLanguage } = require('../_lib/market');
const { checkMissedCheckins } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) throw error;
    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let nudged = 0;
    const results = [];

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const endDate = new Date(client.program_ends_at);
      if (now > endDate) {
        await supabase
          .from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        continue;
      }

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin) continue;

      const market = detectMarket(client.phone);
      const lang = getLanguage(market);
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      const templateName = lang === 'hinglish' ? 'weekly_checkin_hi' : 'weekly_checkin_en';
      const result = await sendTemplate(client.phone, templateName, {
        name: client.name || 'there',
        templateParams: [client.name || 'there', String(currentWeek), checkinUrl]
      });

      if (result.success) sent++;

      await checkMissedCheckins(client.id);

      results.push({
        client_id: client.id,
        phone: maskPhone(client.phone),
        week: currentWeek,
        sent: result.success
      });
    }

    console.log(`Weekly check-in cron: ${sent} sent, ${clients.length} active clients`);

    return res.status(200).json({
      success: true,
      active_clients: clients.length,
      checkins_sent: sent,
      results
    });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
