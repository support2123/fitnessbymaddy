const supabase = require('../../lib/supabase');
const { sendClientMessage, notifyMaddy } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  // Verify Vercel cron authorization
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get all active clients
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ ok: true, processed: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      // Calculate current week number
      const started = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - started) / (7 * 24 * 60 * 60 * 1000));

      // Check if program has ended
      if (client.program_ends_at && now > new Date(client.program_ends_at)) {
        await supabase
          .from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        continue;
      }

      // Check for 2 consecutive missed check-ins
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const submittedWeeks = (recentCheckins || []).map(c => c.week_no);
      if (weekNo > 2 && !submittedWeeks.includes(weekNo - 1) && !submittedWeeks.includes(weekNo - 2)) {
        await notifyMaddy(
          '2 Missed Check-ins',
          `Client: ${client.name} (${client.phone.slice(-4)}) has missed 2 consecutive check-ins. Week ${weekNo}.`
        );
        escalated++;
      }

      // Send check-in form link
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      await sendClientMessage(
        client.phone,
        'weekly_checkin',
        [client.name || 'there', String(weekNo), checkinUrl],
        client.name
      );
      sent++;
    }

    return res.status(200).json({ ok: true, sent, escalated, total: clients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
