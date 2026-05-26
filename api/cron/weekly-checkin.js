const supabase = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { checkConsecutiveMissedCheckins } = require('../../lib/escalation');
const { maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  // Verify cron authorization
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Fetch all active clients
    const { data: clients, error } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (error) {
      console.error('Fetch clients error:', error);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    let sent = 0;
    let skipped = 0;
    let escalated = 0;

    for (const client of (clients || [])) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysDiff = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.max(1, Math.ceil(daysDiff / 7));

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

      // Check for consecutive missed check-ins
      await checkConsecutiveMissedCheckins(client.id);

      // Send check-in form link
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      const result = await sendTemplate(
        client.phone,
        'weekly_checkin',
        [client.name || 'there', String(weekNo), checkinUrl],
        client.name
      );

      if (result.ok) {
        sent++;
      }

      console.log(`Check-in W${weekNo} → ${maskPhone(client.phone)}: ${result.ok ? 'sent' : result.error}`);
    }

    console.log(`Weekly check-in cron: ${sent} sent, ${skipped} skipped, ${escalated} escalated`);
    return res.status(200).json({ ok: true, sent, skipped, escalated });

  } catch (err) {
    console.error('Weekly check-in cron error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
