const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isService = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;
  if (!isCron && !isService && req.method === 'POST') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();

    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, processed: 0 });
    }

    let sent = 0;
    let nudged = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin) {
        continue;
      }

      const { data: lastCheckin } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .single();

      const missedWeeks = lastCheckin
        ? currentWeek - lastCheckin.week_no - 1
        : currentWeek - 1;

      if (missedWeeks >= 2) {
        await sendWhatsApp(
          '+917082478374',
          `ALERT: ${client.name || client.phone} has missed ${missedWeeks} consecutive check-ins. Please review.`
        );
      }

      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      const checkinLink = `${baseUrl}/checkin?c=${client.id}&w=${currentWeek}`;

      const msg = `Hey ${client.name || 'there'}! Time for your Week ${currentWeek} check-in. Fill it out here: ${checkinLink}`;
      await sendWhatsApp(client.phone, msg, 'weekly_checkin');
      sent++;
    }

    return res.status(200).json({ ok: true, sent, nudged });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
