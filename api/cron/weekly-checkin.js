const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { notifyMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  // Verify Vercel Cron secret
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get all active clients
    const { data: clients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) throw error;

    const results = { sent: 0, skipped: 0, escalated: 0 };

    for (const client of clients || []) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.floor(daysSinceStart / 7) + 1;

      // Check if program has ended
      if (client.program_ends_at && now > new Date(client.program_ends_at)) {
        results.skipped++;
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
      if (weekNo >= 3 && !submittedWeeks.includes(weekNo - 1) && !submittedWeeks.includes(weekNo - 2)) {
        await notifyMaddy('2 consecutive missed check-ins', {
          phone: client.phone,
          name: client.name,
          message: `${client.name} missed weeks ${weekNo - 2} and ${weekNo - 1}`
        });
        results.escalated++;
      }

      // Send check-in form link
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(weekNo),
        checkinUrl
      ]);

      results.sent++;
    }

    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
