const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  // Verify cron authorization (Vercel sends this header)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    // Get all active clients
    const { data: clients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let errors = 0;

    for (const client of clients) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const diffMs = now - startDate;
      const weekNo = Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));

      if (weekNo < 1) continue;

      // Check if they already submitted this week's check-in
      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      // Send check-in form link
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      try {
        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          `Week ${weekNo}`,
          checkinUrl
        ]);
        sent++;
      } catch (sendErr) {
        console.error(`[Cron] Failed to send check-in to ${maskPhone(client.phone)}:`, sendErr.message);
        errors++;
      }
    }

    return res.status(200).json({
      message: 'Weekly check-in cron complete',
      total_clients: clients.length,
      sent,
      errors
    });

  } catch (err) {
    console.error('[Cron Weekly] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
