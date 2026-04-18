const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) throw error;
    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / 86400000);
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) { skipped++; continue; }

      // Check if already submitted this week
      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) { skipped++; continue; }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(weekNo),
        checkinUrl,
      ]);

      sent++;
      console.log(`Check-in sent: ${maskPhone(client.phone)} Week ${weekNo}`);
    }

    // Check for clients who missed 2 consecutive check-ins
    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate) / 86400000);
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 3) continue;

      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const submittedWeeks = (recentCheckins || []).map(c => c.week_no);
      const missed = !submittedWeeks.includes(currentWeek - 1) && !submittedWeeks.includes(currentWeek - 2);

      if (missed) {
        await sendTemplate(process.env.MADDY_PHONE, 'escalation_alert', [
          maskPhone(client.phone),
          '2 consecutive missed check-ins',
          `${client.name || 'Client'} — ${client.program} — Week ${currentWeek}`,
        ]);
      }
    }

    return res.status(200).json({ ok: true, sent, skipped });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
