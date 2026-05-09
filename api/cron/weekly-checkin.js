const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  // Verify cron authorization
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get all active clients
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    let sent = 0;
    let skipped = 0;
    let escalated = 0;

    for (const client of clients) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      // Check if program has ended
      if (client.program_ends_at && now > new Date(client.program_ends_at)) {
        continue;
      }

      // Check if already submitted this week
      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) {
        skipped++;
        continue;
      }

      // Check for 2 consecutive missed check-ins
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1);

      if (recentCheckins && recentCheckins.length > 0) {
        const lastWeek = recentCheckins[0].week_no;
        if (weekNo - lastWeek >= 3) {
          await escalateToMaddy(
            '2+ consecutive missed check-ins',
            client.phone,
            `Client ${client.name || 'Unknown'} hasn't checked in since week ${lastWeek}. Currently week ${weekNo}.`
          );
          escalated++;
        }
      }

      // Send check-in form link
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        `${weekNo}`,
        checkinUrl
      ]);
      sent++;
    }

    return res.status(200).json({
      success: true,
      sent,
      skipped,
      escalated,
      total_clients: clients.length
    });

  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
