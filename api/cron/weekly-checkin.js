const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../../lib/whatsapp');
const { logMessage } = require('../../lib/messages');

module.exports = async function handler(req, res) {
  // Verify this is a legitimate cron call
  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  // Get all active clients
  const { data: clients, error } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (error || !clients) {
    console.error('Failed to fetch active clients:', error?.message);
    return res.status(500).json({ error: 'Failed to fetch clients' });
  }

  const results = { sent: 0, skipped: 0, failed: 0 };

  for (const client of clients) {
    // Calculate current week number
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const weekNo = Math.ceil(daysSinceStart / 7);

    if (weekNo < 1) {
      results.skipped++;
      continue;
    }

    // Check if program has ended
    if (client.program_ends_at && new Date(client.program_ends_at) < now) {
      results.skipped++;
      continue;
    }

    // Check if already submitted this week
    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .maybeSingle();

    if (existing) {
      results.skipped++;
      continue;
    }

    // Send check-in form link
    const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

    try {
      await sendWhatsApp(
        client.phone,
        'weekly_checkin',
        [client.name || 'there', `${weekNo}`, checkinUrl]
      );
      await logMessage(client.phone, 'out', `Week ${weekNo} check-in form sent`, 'weekly_checkin');
      results.sent++;
    } catch (err) {
      console.error(`Check-in send failed for ${maskPhone(client.phone)}:`, err.message);
      results.failed++;
    }
  }

  return res.status(200).json({ ok: true, ...results, total: clients.length });
};
