const { getClient } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { notifyMaddy } = require('../_lib/notify');

module.exports = async function handler(req, res) {
  // Vercel Cron sends GET requests with authorization header
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const sb = getClient();
  const results = { sent: 0, nudged: 0, escalated: 0, errors: 0 };

  try {
    // Get all active clients
    const { data: clients } = await sb
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'no active clients', results });
    }

    for (const client of clients) {
      try {
        // Calculate current week number
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / 86400000);
        const currentWeek = Math.floor(daysSinceStart / 7) + 1;

        // Check if program has ended
        if (client.program_ends_at && now > new Date(client.program_ends_at)) {
          continue;
        }

        // Check if this week's check-in already submitted
        const { data: existingCheckin } = await sb
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (existingCheckin) continue; // already submitted

        // Check for 2 consecutive missed check-ins → escalate
        const { data: recentCheckins } = await sb
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1);

        const lastCheckinWeek = recentCheckins && recentCheckins[0]
          ? recentCheckins[0].week_no
          : 0;

        if (currentWeek - lastCheckinWeek >= 3) {
          await notifyMaddy(
            '2+ Missed Check-ins',
            `Client: ${client.name} (${client.phone})\nLast check-in: Week ${lastCheckinWeek}\nCurrent week: ${currentWeek}`
          );
          results.escalated++;
        }

        // Send check-in form link
        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          `Week ${currentWeek}`,
          checkinUrl,
        ], true);

        results.sent++;
      } catch (err) {
        console.error(`checkin cron error for client ${client.id}:`, err.message);
        results.errors++;
      }
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
