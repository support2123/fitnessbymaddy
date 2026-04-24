const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { notifyMaddy } = require('../../lib/whatsapp');

// Flow D — Runs every Sunday 9am IST (cron: 30 3 * * 0 UTC)
// Sends check-in form links to all active clients
module.exports = async function handler(req, res) {
  // Verify this is a cron call (Vercel sends this header)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('Fetch clients error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    const results = { sent: 0, skipped: 0, errors: 0, escalations: 0 };

    for (const client of clients || []) {
      try {
        // Calculate current week number
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

        // Skip if program is past its duration
        if (client.program_ends_at && now > new Date(client.program_ends_at)) {
          results.skipped++;
          continue;
        }

        // Check for 2 consecutive missed check-ins (escalation trigger)
        const { data: recentCheckins } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(2);

        const submittedWeeks = (recentCheckins || []).map(c => c.week_no);
        if (weekNo > 2 && !submittedWeeks.includes(weekNo - 1) && !submittedWeeks.includes(weekNo - 2)) {
          results.escalations++;
          await notifyMaddy('2 Missed Check-ins',
            `${client.name || client.phone} has missed 2 consecutive check-ins (weeks ${weekNo - 2} & ${weekNo - 1})`);
        }

        // Send check-in form link
        const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there', String(weekNo), checkinUrl
        ]);

        results.sent++;
      } catch (err) {
        console.error(`Check-in send error for client ${client.id}:`, err.message);
        results.errors++;
      }
    }

    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Cron job failed' });
  }
};
