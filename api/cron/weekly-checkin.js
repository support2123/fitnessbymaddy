const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  // Verify cron secret or Vercel cron header
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { sent: 0, nudged: 0, escalated: 0, errors: 0 };

    // Get all active clients
    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', results });
    }

    for (const client of clients) {
      try {
        const weekNo = calculateWeekNo(client.program_started_at);
        if (weekNo < 1) continue;

        // Check if check-in already submitted this week
        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (existing && existing.length > 0) continue;

        // Check for 2 consecutive missed check-ins
        const { data: recentCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(2);

        const lastCheckedWeek = recentCheckins?.[0]?.week_no || 0;
        if (weekNo - lastCheckedWeek >= 3) {
          await escalateToMaddy({
            reason: '2 consecutive missed check-ins',
            phone: client.phone,
            context: `Client ${client.name || 'Unknown'}, program: ${client.program}, last check-in: week ${lastCheckedWeek}`
          });
          results.escalated++;
        }

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const message = client.name
          ? `Hey ${client.name}! It's check-in time (Week ${weekNo}). Fill this quick form so we can keep your progress on track:\n\n${checkinUrl}`
          : `Hey! Time for your Week ${weekNo} check-in. Fill this quick form:\n\n${checkinUrl}`;

        await sendWhatsApp({
          phone: client.phone,
          templateName: 'weekly_checkin',
          body: message,
          params: [client.name || 'there', String(weekNo), checkinUrl]
        });

        results.sent++;
      } catch (clientErr) {
        console.error(`Check-in send failed for client ${client.id}:`, clientErr.message);
        results.errors++;
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}
