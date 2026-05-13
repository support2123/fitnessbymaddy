const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, notifyMaddy } = require('../_lib/whatsapp');
const { maskPhone } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await getSupabase()
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      if (weekNo < 1) continue;

      const { data: existing } = await getSupabase()
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        `${weekNo}`,
        checkinUrl
      ], client.name);
      sent++;

      // Check for 2 consecutive missed check-ins
      const { data: recentCheckins } = await getSupabase()
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1);

      const lastCheckinWeek = recentCheckins?.[0]?.week_no || 0;
      if (weekNo - lastCheckinWeek >= 3) {
        await notifyMaddy(
          '2+ consecutive missed check-ins',
          `Client: ${client.name || maskPhone(client.phone)}\nProgram: ${client.program}\nLast check-in: Week ${lastCheckinWeek}\nCurrent: Week ${weekNo}`
        );
        escalated++;
      }
    }

    return res.json({ sent, escalated, total_clients: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
