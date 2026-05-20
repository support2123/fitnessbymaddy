const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');
const { maskPhone } = require('../../lib/mask-phone');

module.exports = async function handler(req, res) {
  // Verify cron secret (Vercel sends this header for cron jobs)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    // Allow if no CRON_SECRET is set (for testing)
    if (process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    // Get all active clients
    const { data: clients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('Failed to fetch clients:', error.message);
      return res.status(500).json({ error: 'Database error' });
    }

    const results = { sent: 0, skipped: 0, escalated: 0 };

    for (const client of clients || []) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.floor(daysSinceStart / 7) + 1;

      // Check if program has ended
      if (client.program_ends_at && new Date(client.program_ends_at) < new Date()) {
        results.skipped++;
        continue;
      }

      // Check for consecutive missed check-ins
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const lastCheckinWeek = recentCheckins?.[0]?.week_no || 0;
      const missedWeeks = currentWeek - lastCheckinWeek - 1;

      if (missedWeeks >= 2) {
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          client.phone,
          `${client.name || 'Client'} missed weeks ${lastCheckinWeek + 1} and ${lastCheckinWeek + 2}`
        );
        results.escalated++;
      }

      // Send check-in form link
      const formUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name ? client.name.split(' ')[0] : 'there',
        String(currentWeek),
        formUrl
      ], true);

      console.log(`Check-in sent to ${maskPhone(client.phone)} for week ${currentWeek}`);
      results.sent++;
    }

    return res.status(200).json({
      ok: true,
      ...results,
      total_clients: clients?.length || 0
    });

  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
